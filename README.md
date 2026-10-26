# TrustLens

Runs an npm or Python package in a locked-down sandbox, records what it actually does, and
compares that with what its README says it does.

## Workflow

1. **Intake.** `sandbox/run_scan.py` packs the package (`npm pack`) and records the sha256.
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
python scripts/scan.py fixtures/py-titlecase   # all variants, combined result
python sandbox/run_scan.py fixtures/http-fetchy
python sandbox/run_scan.py fixtures/http-fetchy --variant ci
```

## Fixes to the original plan

- `http.get` bypasses a patched `http.request`, so both are patched (plus `fetch` and `dns`).
- `--read-only` breaks `npm install`, so `/work`, `/tmp` and the home dir are tmpfs.
- The hook ignores npm's own activity and only follows the processes npm spawns.
- When child_process copies the env for a child, the hook stops logging, so a spawn doesn't look like reading every variable.
- `libfaketime` can stall Node timers, so for Node the date is shifted inside the hook. Python uses libfaketime (with `FAKETIME_DONT_FAKE_MONOTONIC=1`).
- Shell scripts are forced to LF (`.gitattributes`) so they run in Linux containers from Windows.
- Running with `--network none` removes the DNS/internal-network and TLS issues entirely.
