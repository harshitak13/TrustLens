"""Raw hook lines -> schema events -> capability strings.

Schema event: {ts, scan, variant, stage, type, target, detail, token}.
Capabilities: net:<host>, file:read:<path>, file:write:<path>, env:<NAME>,
proc:<cmd>. Home paths are rewritten to "~" so they match README claims.
"""
import posixpath

HOME = "/home/dev"

NOISE_ENV = {"PATH", "HOME", "PWD", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR", "TZ",
             "NODE_OPTIONS", "NODE_ENV", "NODE_DEBUG", "NODE_EXTRA_CA_CERTS", "NODE_PATH",
             "NODE_V8_COVERAGE", "NODE_UNIQUE_ID", "NODE_CHANNEL_FD", "UV_THREADPOOL_SIZE",
             "INIT_CWD", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_USE_SYSTEM_CA", "FORCE_COLOR", "NO_COLOR", "NODE_NO_WARNINGS"}
NOISE_ENV_PREFIX = ("TL_", "npm_", "NPM_", "NODE_TEST")

# Module loading reads every .js/.json it requires; that's not behaviour.
NOISE_PATH_PREFIX = ("/usr/", "/trustlens/", "/proc/self/", "/lib/", "/etc/ssl/")
CODE_EXT = (".js", ".cjs", ".mjs", ".json", ".node", ".py", ".pyc", ".so", ".pth", ".typed")


def _is_noise_file(path: str, pkg: str) -> bool:
    if path.startswith(NOISE_PATH_PREFIX) or path.startswith("/events/"):
        return True
    if "/node_modules/" in path and path.endswith(CODE_EXT):
        return True
    # Python: the installed package, its source copy, pip's build temp dirs.
    if path.startswith(("/work/site", "/work/src", "/tmp/")) or path in ("/work/snippet.py", "/dev/null", "/trustlens"):
        return True
    if path.startswith(f"/work/node_modules/{pkg}/") or path in ("/work", "/work/package.json", "/work/snippet.js"):
        return True
    return False


def _home(path: str) -> str:
    return "~" + path[len(HOME):] if path == HOME or path.startswith(HOME + "/") else path


def _host(target: str) -> str:
    if target.startswith("unix:"):
        return target
    host = target.rsplit(":", 1)[0] if target.count(":") == 1 else target
    return host.strip("[]")


def to_events(raw, scan_id, variant, pkg):
    markers = [r for r in raw if r.get("type") == "stage"]
    t0 = markers[0]["t"] if markers else (raw[0]["t"] if raw else 0)
    out = []
    for r in raw:
        if r.get("type") == "stage":
            continue
        typ, target = r["type"], r["target"]
        if typ == "file" and _is_noise_file(target, pkg):
            continue
        if typ == "env" and (target in NOISE_ENV or target.startswith(NOISE_ENV_PREFIX)):
            continue
        if typ == "net" and target.startswith(("localhost", "127.", "::1")):
            continue
        out.append({"ts": round((r["t"] - t0) / 1000, 3), "scan": scan_id, "variant": variant,
                    "stage": r.get("stage", "unknown"), "type": typ, "target": target,
                    "detail": r.get("detail", {}), "token": r.get("token")})
    out.sort(key=lambda e: e["ts"])
    return out


def capability(ev):
    typ, t, d = ev["type"], ev["target"], ev["detail"]
    if typ in ("net", "dns"):
        return f"net:{_host(t)}"
    if typ == "file":
        op = d.get("op", "read")
        return f"file:{op}:{_home(posixpath.normpath(t))}"
    if typ == "env":
        return f"env:{t}"
    if typ == "proc":
        # npm runs lifecycle scripts as `sh -c "<script>"`; name the script itself.
        args = d.get("args") or []
        if "/bin/npm" in d.get("argv1", "") and posixpath.basename(t) == "sh" and "-c" in args:
            return f"proc:install-script:{args[args.index('-c') + 1]}"
        cmd = t.split()[0] if d.get("shell") else t
        return f"proc:{posixpath.basename(cmd)}"
    return f"{typ}:{t}"


def capabilities(events):
    """One row per (capability, stage), with first time seen and count."""
    rows = {}
    for ev in events:
        key = (capability(ev), ev["stage"])
        row = rows.setdefault(key, {"cap": key[0], "stage": key[1], "first_ts": ev["ts"], "count": 0})
        row["count"] += 1
    return sorted(rows.values(), key=lambda r: r["first_ts"])
