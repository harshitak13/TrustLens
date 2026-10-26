# TrustLens

Runs a package in a locked-down sandbox, records what it actually does, and
compares that with what its README says it does.

## Workflow

1. **Intake.** `sandbox/run_scan.py` packs the package (`npm pack`) and records the sha256.
2. **Sandbox run.** One container per scan and variant: `--network none`, `--cap-drop ALL`,
   `--read-only` with tmpfs for `/tmp`, `/work`, `/home/dev`, memory/CPU/pid limits.
   `run.sh` runs two stages: `install` (`npm install --offline` from the local tarball) and
   `import` (`require` the package, then stay alive 4s).
3. **Observe.** `sandbox/node/node-hook.js` is loaded into every node process via
   `NODE_OPTIONS`. It logs network attempts (socket connect, http/https request+get, fetch, DNS),
   file reads/writes, env reads (first read per name) and process spawns. With networking off,
   connections fail but the attempt and its hostname are still logged.
4. **Normalize.** `diff/normalize.py` drops noise (module loading, npm itself, standard env vars)
   and turns events into capability strings: `net:<host>`, `file:read:~/...`, `env:NAME`, `proc:cmd`.
   Output: `scans/<pkg>@<ver>.<variant>.json`.
5. **Claims** (next): README code fences + package.json metadata + prose rules, and one optional
   LLM call into `{network, files, env, subprocess, explicit_denials}`, schema-validated.
6. **Diff + verdict** (next): each capability is `claimed`, `expected` (category prior),
   `unclaimed` or `contradicted`; severity lookup table; verdict = max severity.
7. **Hidden-trigger hunter.** Re-run with `--variant ci|later|host|user`; any capability present
   in a variant but not in baseline is a finding. `later` shifts `Date` inside the hook
   (`TL_FAKE_DATE`) instead of using libfaketime.
8. **API + UI** (next): FastAPI over `scans/`, React diff screen reading cached results.

## Run

```bash
docker build -t trustlens-node sandbox/node
python sandbox/run_scan.py fixtures/http-fetchy
python sandbox/run_scan.py fixtures/http-fetchy --variant ci
```

## Fixes to the original plan

- `http.get` bypasses a patched `http.request`, so both are patched (plus `fetch` and `dns`).
- `--read-only` breaks `npm install`, so `/work`, `/tmp` and the home dir are tmpfs.
- The hook ignores npm's own activity and only follows the processes npm spawns.
- When child_process copies the env for a child, the hook stops logging, so a spawn doesn't look like reading every variable.
- `libfaketime` can stall Node timers, so the date is shifted inside the hook.
- Shell scripts are forced to LF (`.gitattributes`) so they run in Linux containers from Windows.
- Running with `--network none` removes the DNS/internal-network and TLS issues entirely.
