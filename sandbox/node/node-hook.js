'use strict';
// TrustLens Node hook. Loaded into every node process in the sandbox via
// NODE_OPTIONS=--require /trustlens/node-hook.js. Writes one JSON line per
// observed action to $TL_EVENTS. Raw events carry an epoch "t"; the host-side
// merger turns that into the scan-relative "ts" of the event schema.

const fs = require('fs');
const path = require('path');

// Capture originals before patching so our own logging is never logged.
const appendFileSync = fs.appendFileSync;
const realNow = Date.now;

const LOG = process.env.TL_EVENTS || '/events/hook.jsonl';
const STAGE = process.env.TL_STAGE || 'unknown';
const ARGV1 = process.argv[1] || '';
// npm itself runs with the hook too. For npm we only want the processes it
// spawns (lifecycle scripts), not its own cache/registry/fs chatter.
const IS_NPM = /npm-cli\.js|npx-cli\.js|[\\/]node_modules[\\/]npm[\\/]|[\\/]bin[\\/]np[mx]$/.test(ARGV1);

let busy = false;
function emit(type, target, detail) {
  if (busy) return;
  busy = true;
  try {
    const ev = {
      t: realNow(), stage: STAGE, type, target: String(target),
      detail: Object.assign({ pid: process.pid, argv1: ARGV1 }, detail),
    };
    appendFileSync(LOG, JSON.stringify(ev) + '\n');
  } catch (_) { /* never break the host program */ }
  busy = false;
}

// Set while child_process copies process.env for a child, so that copy
// doesn't show up as the package reading every variable.
let envQuiet = 0;

function wrap(obj, name, onCall, quietEnv = false) {
  const orig = obj && obj[name];
  if (typeof orig !== 'function') return;
  const patched = function (...args) {
    try { onCall(args); } catch (_) {}
    if (!quietEnv) return orig.apply(this, args);
    envQuiet++;
    try { return orig.apply(this, args); } finally { envQuiet--; }
  };
  Object.defineProperty(patched, 'name', { value: orig.name });
  obj[name] = patched;
}

// ---- clock: hunter "later date" variant. Shifting Date in-process is more
// reliable for Node than libfaketime, which can stall timers. realNow above
// keeps event timestamps on the true clock.
if (process.env.TL_FAKE_DATE) {
  const offset = Date.parse(process.env.TL_FAKE_DATE) - realNow();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(realNow() + offset); else super(...a); }
    static now() { return realNow() + offset; }
  }
  globalThis.Date = FakeDate;
}

// ---- processes (also for npm, so we see the lifecycle scripts it runs) ----
const cp = require('child_process');
function procTarget(args, shell) {
  const [file, rest] = args;
  if (shell) return { cmd: String(file) };
  return { cmd: String(file), args: Array.isArray(rest) ? rest.map(String) : [] };
}
for (const fn of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) {
  wrap(cp, fn, (a) => { const d = procTarget(a, false); emit('proc', d.cmd, { op: fn, args: d.args }); }, true);
}
for (const fn of ['exec', 'execSync']) {
  wrap(cp, fn, (a) => emit('proc', String(a[0]), { op: fn, shell: true }), true);
}

if (!IS_NPM) {
  // ---- network ----
  const net = require('net');
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    try {
      let opts = args[0];
      if (Array.isArray(opts)) opts = opts[0]; // internal normalized form
      if (typeof opts !== 'object' || opts === null) {
        opts = typeof args[0] === 'string' && isNaN(Number(args[0]))
          ? { path: args[0] } : { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' };
      }
      if (opts.path) emit('net', 'unix:' + opts.path, { op: 'connect' });
      else emit('net', `${opts.host || 'localhost'}:${opts.port}`, { op: 'connect' });
    } catch (_) {}
    return origConnect.apply(this, args);
  };

  function reqTarget(proto, args) {
    let u = args[0];
    let o = typeof args[1] === 'object' && typeof args[1] !== 'function' ? args[1] : {};
    if (typeof u === 'string') { try { u = new URL(u); } catch (_) { u = {}; } }
    if (u instanceof URL) {
      return { url: u.href, host: u.hostname, method: (o.method || 'GET').toUpperCase() };
    }
    o = Object.assign({}, u, o);
    const host = o.hostname || o.host || 'localhost';
    return { url: `${proto}//${host}${o.port ? ':' + o.port : ''}${o.path || '/'}`, host,
      method: (o.method || 'GET').toUpperCase() };
  }
  // http.get calls the module-local request, so get must be patched separately.
  for (const [mod, proto] of [[require('http'), 'http:'], [require('https'), 'https:']]) {
    for (const fn of ['request', 'get']) {
      wrap(mod, fn, (a) => { const r = reqTarget(proto, a); emit('net', r.host, { op: 'http', method: fn === 'get' ? 'GET' : r.method, url: r.url }); });
    }
  }
  if (typeof globalThis.fetch === 'function') {
    wrap(globalThis, 'fetch', (a) => {
      const u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || String(a[0]);
      let host = u; try { host = new URL(u).hostname; } catch (_) {}
      emit('net', host, { op: 'fetch', method: ((a[1] && a[1].method) || 'GET').toUpperCase(), url: u });
    });
  }

  // A package that opens a listening port is a possible backdoor.
  const origListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    try {
      const a = args[0];
      const port = typeof a === 'object' && a !== null ? (a.port ?? a.path) : a;
      emit('listen', port === undefined ? 'any' : port, { op: 'listen' });
    } catch (_) {}
    return origListen.apply(this, args);
  };

  const dns = require('dns');
  for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
    wrap(dns, fn, (a) => emit('dns', a[0], { op: fn }));
    if (dns.promises) wrap(dns.promises, fn, (a) => emit('dns', a[0], { op: fn }));
  }

  // ---- files ----
  const p = (x) => {
    if (typeof x === 'number') return null; // fd, already logged at open
    try { return path.resolve(x instanceof URL ? x.pathname : String(x)); } catch (_) { return null; }
  };
  const fileOp = (op) => (a) => { const f = p(a[0]); if (f) emit('file', f, { op }); };
  for (const fn of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream', 'readdirSync', 'readdir']) {
    wrap(fs, fn, fileOp(fn.startsWith('readdir') ? 'list' : 'read'));
  }
  for (const fn of ['writeFileSync', 'writeFile', 'createWriteStream']) {
    wrap(fs, fn, fileOp('write'));
  }
  for (const fn of ['readFile', 'open', 'readdir']) wrap(fs.promises, fn, fileOp(fn === 'readdir' ? 'list' : 'read'));
  wrap(fs.promises, 'writeFile', fileOp('write'));

  // ---- env ----
  const seen = new Set();
  const realEnv = process.env;
  process.env = new Proxy(realEnv, {
    get(target, key) {
      if (!envQuiet && typeof key === 'string' && !seen.has(key)) { seen.add(key); emit('env', key, { op: 'get' }); }
      return target[key];
    },
  });
}
