# How the TrustLens sandbox works

TrustLens answers one question about a package: **does it do what its README says, and nothing else?**
To answer it, the package really is installed and run, inside a throwaway Linux container, while
a hook inside the language runtime writes down everything it does.

## 1. What you can give it

| Input | Example | Where it comes from |
|---|---|---|
| npm package | `npm:express@4.21.1` | npm registry (`npm pack`, no scripts run) |
| PyPI package | `pypi:requests==2.32.3` | PyPI wheel (`pip download`, binary only) |
| Upload | `my-lib.zip`, `my-lib-1.0.0.tgz`, `my_lib-1.0-py3-none-any.whl` | UI "upload" tab or `POST /upload` |
| Local fixture | `fixtures/ci-sleeper` | test packages in this repo |

Not supported: websites, mobile/desktop apps, Docker images, other languages.

## 2. One scan, step by step

```
your machine (host)                                 sandbox container (one per variant)
────────────────────────────────────────            ─────────────────────────────────────────
1 intake      download / unpack as data             
2 deps        fetch dependency tarballs/wheels       
              (no install scripts, no builds)        
3 claims      read README + package.json/pyproject  
4 snippets    README code examples -> files         
5 docker run  ───────────────────────────────────▶  install   npm install --offline / pip --no-index
                                                     import    require/import the package, wait 4s
                                                     snippet   run each README example (max 10)
                                                     (the hook logs every action to events.jsonl)
6 normalize   ◀─────────────── events.jsonl ──────
7 diff        claims vs observed -> status + severity
8 hunter      repeat 5-7 for ci / later / host / user, compare
9 save        scans/<pkg>@<ver>.json -> API -> UI
```

Steps 1–4 run on the host but **never execute the package's code**: archives are unpacked with
path checks, npm runs with `--ignore-scripts`, pip only downloads binary wheels. The package's
code (including its install scripts) runs only in step 5, inside the container.

## 3. The container

Every variant gets a brand-new container that is deleted afterwards (`docker run --rm`):

| Setting | Effect |
|---|---|
| `--network none` | No network at all. Connection attempts fail, but the hook still records where it tried to go. |
| `--cap-drop ALL`, `no-new-privileges` | No Linux capabilities, can't gain root. Runs as user `dev` (uid 1001). |
| `--read-only` + tmpfs `/work`, `/tmp`, `/home/dev` | Filesystem is read-only except scratch space that vanishes with the container. |
| `--memory 512m --cpus 1 --pids-limit 256` | Can't exhaust the machine or fork-bomb. |
| Mounts: `/pkg` (ro), `/deps` (ro), `/trustlens` (ro, the hook), `/events` (rw, the log) | Nothing else from your machine is visible. No home folder, no Docker socket. |

## 4. The hook (how behaviour is observed)

- **Node:** `node-hook.js` is preloaded into every node process with `NODE_OPTIONS=--require`.
  It wraps socket connect, http/https request+get, fetch, DNS lookups, file reads/writes/listing,
  child_process (spawn/exec/fork) and reads of `process.env`.
  npm's own activity is ignored; the scripts npm starts are followed.
- **Python:** `sitecustomize.py` is loaded automatically. It registers `sys.addaudithook`
  (files, sockets, DNS, subprocess, os.system) and wraps `os.environ` reads.
  pip itself and the standard library's own env scanning are ignored.

Every action becomes a line like
`{"t": 1793047041458, "stage": "import", "type": "net", "target": "status.http-fetchy.test:443"}`.

## 5. From events to a verdict

1. **Normalize** to capability strings: `net:<host>`, `file:read:~/.ssh/id_rsa`, `env:NAME`,
   `proc:curl`, `proc:install-script:<cmd>`. Noise (module loading, runtime internals) is dropped.
2. **Claims** from the README and metadata: hosts in examples or "makes requests to" sentences,
   env vars and files it names, commands it says it runs, and denials ("no network", "pure function").
3. **Status** for each observed capability:
   `claimed` (README says so) · `expected` (normal for its category, e.g. an HTTP client fetching
   when called) · `unclaimed` (not mentioned) · `contradicted` (README says it doesn't).
4. **Severity** by rule (e.g. contradicted network = critical, unclaimed network on import = high,
   unclaimed env read = low). Verdict = the worst row.
5. **Hidden-trigger hunter:** the same run under `CI=true`, a 2027 date, another hostname and
   another user. Behaviour that only appears in one of them is a *hidden trigger*; network or
   process behaviour that *disappears* in one is an *evasion*.

## 6. Limits (what it can't see)

See "Known gaps" in README.md.
