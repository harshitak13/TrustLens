# TrustLens

Runs an npm or Python package in a locked-down sandbox, records what it actually does, and
compares that with what its README says it does.

## Workflow

1. **Intake.** `sandbox/intake.py` turns a fixture, `npm:name@ver`, `pypi:name==ver` or an upload (.zip/.tgz/.whl) into a package folder without running any of it; `run_scan.py` packs it, records the sha256 and fetches dependencies.
2. **Sandbox run.** One container per scan and variant: `--network none`, `--cap-drop ALL`,
   `--read-only` with tmpfs for `/tmp`, `/work`, `/home/dev`, memory/CPU/pid limits.
   `run.sh` runs three stages: `install` (offline, from the local copy), `import`, and `snippet`
   (each README code example).
3. **Observe.** `sandbox/node/node-hook.js` is loaded into every node process via
   `NODE_OPTIONS`. It logs network attempts (socket connect, http/https request+get, fetch, DNS),
   file reads/writes, env reads (first read per name) and process spawns. With networking off,
   connections fail but the attempt and its hostname are still logged.
   Python packages use `sandbox/python/sitecustomize.py` instead: `sys.addaudithook` for files,
   sockets, DNS and processes, plus a patched `os._Environ.__getitem__` for env reads. pip itself and
   stdlib env enumeration (urllib proxy lookup) are filtered out; pip's build backend keeps net/proc only.
4. **Normalize.** `diff/normalize.py` drops noise (module loading, npm itself, standard env vars)
   and turns events into capability strings: `net:<host>`, `file:read:~/...`, `env:NAME`, `proc:cmd`.
   Output: `scans/<pkg>@<ver>.<variant>.json`.
5. **Claims.** `claims/parse.py`: README code fences + package.json/pyproject.toml metadata + prose rules
   into `{network, files, env, subprocess, explicit_denials}`, schema-validated (no LLM pass).
6. **Diff + verdict.** `diff/engine.py`: each capability is `claimed`, `expected` (category prior),
   `unclaimed` or `contradicted`; severity lookup table; verdict = max severity.
7. **Hidden-trigger hunter.** Re-run with `--variant ci|later|host|user`; any capability present
   in a variant but not in baseline is a finding; network/process behaviour that disappears in a
   variant is reported as an evasion. `later` shifts `Date` inside the hook
   (`TL_FAKE_DATE`) instead of using libfaketime.
8. **API + UI.** `api/main.py` (FastAPI over `scans/`, scan jobs with SSE progress) and `web/` (React diff screen). See DEMO.md.

## Run

```bash
docker build -t trustlens-node sandbox/node
docker build -t trustlens-python sandbox/python
python scripts/scan.py fixtures/py-titlecase      # all variants, combined result
python scripts/scan.py npm:express@4.21.1         # npm registry (dependencies included)
python scripts/scan.py pypi:requests==2.32.3      # PyPI wheel (dependencies included)
python scripts/scan.py path/to/my-lib.zip         # upload: .zip / .tgz / .tar.gz / .whl
python sandbox/run_scan.py fixtures/http-fetchy --variant ci   # one variant only

# UI: API + web app, then open http://localhost:5173
python -m uvicorn api.main:app --port 8000
npm --prefix web run dev
```

The UI's scan panel has three tabs: **fixture**, **npm / PyPI** (type `npm:name@ver` or
`pypi:name==ver`) and **upload** (pick a file). How the sandbox works is in [SANDBOX.md](SANDBOX.md).

Dependencies: the sandbox has no network, so `sandbox/run_scan.py` downloads dependencies on the
host first, as data only (npm with `--ignore-scripts`, pip binary wheels only), caches them per
package hash in `.trustlens/dc/`, and mounts them read-only at `/deps`. The install inside the
sandbox runs fully offline from there, so dependency install scripts run (and are observed) only
in the sandbox. Tested: express@4.21.1 (69 packages), axios@1.7.7, requests==2.32.3, chalk@5.3.0 (ESM-only).

## Backtest

The malicious event-stream / ua-parser-js versions were unpublished from npm, so instead of
fetching malware samples we backtested on real, popular packages for false positives:
left-pad@1.3.0, ms@2.1.3, is-number@7.0.0, slugify@1.6.6, nanoid@3.3.7, dotenv@16.4.5 all
come back clean (dotenv's `.env` and `DOTENV_CONFIG_*` reads are claimed in its README).
Registry tarballs are fetched with `npm pack --ignore-scripts` and unpacked as data on the host;
nothing from them runs outside the sandbox.

## Known gaps

Honest limits of the current build, roughly in order of importance:

1. **Hooks can be bypassed.** Observation happens inside Node/Python. Native addons, prebuilt
   binaries and raw syscalls are invisible, and for a spawned program (`curl`, `sh`) we see its
   command line but not what it does. Fix: an `strace`/eBPF pass as ground truth (not built).
2. **No network means no payloads.** We see *where* a package tries to connect, not *what* it would
   send, and multi-stage malware that needs a server reply never reaches stage two.
3. **Short runs.** Import waits 4s, each README example gets 8s (max 8 examples). Code that waits
   longer, or only runs when you call a specific function, isn't exercised.
4. **Claims are rules, not understanding.** Without an LLM pass the README parser can miss
   unusual wording (under-claiming → false flags) or pick up stray paths (over-claiming).
5. **Category is a keyword guess** (string-utils, http-client, cli-tool, parser).
6. **Install limits.** No compilers in the sandbox, so packages that build native code (node-gyp,
   Python sdists with C extensions) fail to install; Python dependencies must have Linux CPython
   3.11 wheels. Packages that download extra binaries at install time (e.g. browsers) fail and show
   up as flagged network attempts.
7. **Container, not VM.** Docker isolates with namespaces; a kernel exploit could escape. On Windows,
   Docker Desktop adds a WSL2 VM layer.
8. **Demo-grade API.** No auth, meant for localhost; uploads capped at 50 MB; results are keyed by
   `name@version`, so a re-scan overwrites; `.trustlens/` is never cleaned up.

## Fixes to the original plan

- `http.get` bypasses a patched `http.request`, so both are patched (plus `fetch` and `dns`).
- `--read-only` breaks `npm install`, so `/work`, `/tmp` and the home dir are tmpfs.
- The hook ignores npm's own activity and only follows the processes npm spawns.
- When child_process copies the env for a child, the hook stops logging, so a spawn doesn't look like reading every variable.
- `libfaketime` can stall Node timers, so for Node the date is shifted inside the hook. Python uses libfaketime (with `FAKETIME_DONT_FAKE_MONOTONIC=1`).
- Shell scripts are forced to LF (`.gitattributes`) so they run in Linux containers from Windows.
- Running with `--network none` removes the DNS/internal-network and TLS issues entirely.
