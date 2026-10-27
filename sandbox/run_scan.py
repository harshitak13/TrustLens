"""Run one npm or Python package through the sandbox and write scans/<pkg>@<ver>.json.

Usage: python sandbox/run_scan.py fixtures/pad-clean [--variant baseline|ci|later|host|user]
       python sandbox/run_scan.py npm:left-pad@1.3.0 | pypi:requests==2.32.3 | upload.zip|.tgz|.whl

Host side, stdlib only. Packs the package (recording its sha256), runs it in a
locked-down container with networking off, then turns the hook log into the
event schema plus capability strings for the diff engine.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from diff.normalize import to_events, capabilities  # noqa: E402
from diff.engine import diff  # noqa: E402
from claims.parse import load_meta, parse  # noqa: E402
from sandbox import intake  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
NPM = "npm.cmd" if os.name == "nt" else "npm"
MAX_SNIPPETS = 8
WORK = ROOT / ".trustlens"
# ecosystem -> (image, hook dir mounted at /trustlens, snippet extension)
ECOSYSTEMS = {
    "npm": ("trustlens-node", "node", "js"),
    "python": ("trustlens-python", "python", "py"),
}

# Hidden-trigger hunter variants: extra docker args and env per variant.
VARIANTS = {
    "baseline": ([], {}),
    "ci": ([], {"CI": "true", "GITHUB_ACTIONS": "true"}),
    "later": ([], {"TL_FAKE_DATE": "2027-06-01T00:00:00Z"}),
    "host": (["--hostname", "build-server-01"], {}),
    "user": ([], {"USER": "admin", "LOGNAME": "admin"}),
}


def run(cmd):
    return subprocess.run(cmd, check=True, text=True, capture_output=True)


def pack(pkg_dir: Path, out: Path):
    ecosystem, meta = load_meta(pkg_dir)
    if ecosystem == "python" and (pkg_dir / ".tl-wheel").exists():
        # A wheel (from PyPI or an upload): the sandbox installs the wheel itself.
        whl = pkg_dir / (pkg_dir / ".tl-wheel").read_text(encoding="utf-8").strip()
        (out / "wheel").mkdir()
        shutil.copy2(whl, out / "wheel" / whl.name)
        return ecosystem, meta["name"], meta["version"], hashlib.sha256(whl.read_bytes()).hexdigest()
    if ecosystem == "python":
        # Installed from a copy of the source tree; hash every file in order.
        shutil.copytree(pkg_dir, out / "src", ignore=shutil.ignore_patterns("__pycache__", "*.egg-info", "build"))
        h = hashlib.sha256()
        for f in sorted(p for p in (out / "src").rglob("*") if p.is_file()):
            h.update(f.relative_to(out / "src").as_posix().encode())
            h.update(f.read_bytes())
        return ecosystem, meta["name"], meta["version"], h.hexdigest()
    # --ignore-scripts: never run a package's prepack/prepare hooks on the host.
    res = run([NPM, "pack", str(pkg_dir), "--pack-destination", str(out), "--json", "--ignore-scripts"])
    tgz = out / json.loads(res.stdout)[0]["filename"]
    final = out / "pkg.tgz"
    tgz.replace(final)
    return ecosystem, meta["name"], meta["version"], hashlib.sha256(final.read_bytes()).hexdigest()


def prepare_deps(ecosystem: str, src_dir: Path, pkg_dir: Path, sha: str) -> Path:
    """The sandbox has no network, so dependencies are fetched here first, as
    data only (no install scripts, no builds), and mounted read-only at /deps.
    npm: an npm cache holding every tarball the install needs.
    python: binary wheels for the declared dependencies (Linux, CPython 3.11).
    Cached per package hash (short dir name: npm cache paths are deep and
    Windows paths max out at 260 chars), so the five variants download once."""
    cache = WORK / "dc" / sha[:16]
    if not cache.exists():
        tmp = cache.with_name(sha[:16] + ".tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        if ecosystem == "npm":
            # Throwaway install target; only the cache it fills is kept.
            prefix = WORK / "dp" / uuid.uuid4().hex[:8]
            prefix.mkdir(parents=True)
            (prefix / "package.json").write_text('{"name":"tl-deps","version":"0.0.0","private":true}')
            try:
                run([NPM, "install", str(pkg_dir / "pkg.tgz"), "--prefix", str(prefix), "--cache", str(tmp / "npmcache"),
                     "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"])
            finally:
                shutil.rmtree(prefix, ignore_errors=True)
        else:
            deps = load_meta(src_dir)[1].get("dependencies", [])
            (tmp / "wheels").mkdir()
            if deps:
                run([sys.executable, "-m", "pip", "download", *deps, "--dest", str(tmp / "wheels"),
                     "--only-binary=:all:", "--platform", "manylinux2014_x86_64", "--platform", "manylinux_2_28_x86_64",
                     "--python-version", "3.11", "--implementation", "cp", "--quiet"])
        tmp.rename(cache)
    return cache


def snippet_source(ecosystem: str, code: str) -> str:
    """Python READMEs often show REPL sessions (`>>> x`); keep only the input
    lines so the example runs as a script."""
    if ecosystem == "python" and re.search(r"^\s*>>> ", code, re.M):
        lines = [l.strip()[4:] for l in code.splitlines() if l.strip().startswith((">>> ", "... ", ">>>", "..."))]
        return "\n".join(lines) + "\n"
    return code


def snippet_ext(ecosystem: str, code: str) -> str:
    if ecosystem == "python":
        return "py"
    # ES module syntax needs .mjs to run without a package.json "type" field.
    return "mjs" if re.search(r"^\s*(import\s[^(]|export\s)", code, re.M) else "js"


def docker_run(ecosystem, name, pkg_dir: Path, deps_dir: Path, events_dir: Path, variant: str):
    image, hook_dir, _ = ECOSYSTEMS[ecosystem]
    extra_args, extra_env = VARIANTS[variant]
    mount = lambda src, dst, ro: ["--mount", f"type=bind,src={src},dst={dst}" + (",readonly" if ro else "")]
    cmd = ["docker", "run", "--rm", "--network", "none",
           "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
           "--read-only", "--memory", "512m", "--cpus", "1", "--pids-limit", "256",
           # --read-only needs writable scratch for npm install and the home dir.
           "--tmpfs", "/tmp:exec,size=256m", "--tmpfs", "/work:exec,size=256m,uid=1001,gid=1001",
           "--tmpfs", "/home/dev:size=16m,uid=1001,gid=1001",
           *mount(pkg_dir, "/pkg", True),
           *mount(ROOT / "sandbox" / hook_dir, "/trustlens", True),
           *mount(deps_dir, "/deps", True),
           *mount(events_dir, "/events", False),
           "-e", f"TL_PKG_NAME={name}", "-e", f"TL_PKG_IMPORT={name.replace('-', '_')}", *extra_args]
    for k, v in extra_env.items():
        cmd += ["-e", f"{k}={v}"]
    cmd += [image, "sh", "/trustlens/run.sh"]
    subprocess.run(cmd, check=False, timeout=600)


def scan(pkg_path: str, variant: str = "baseline"):
    scan_id = uuid.uuid4().hex[:10]
    base = WORK / "runs" / scan_id
    pkg_dir, events_dir = base / "pkg", base / "events"
    pkg_dir.mkdir(parents=True)
    events_dir.mkdir()
    src_dir, source = intake.resolve(pkg_path, base / "intake")
    ecosystem, name, version, sha = pack(src_dir, pkg_dir)
    deps_dir = prepare_deps(ecosystem, src_dir, pkg_dir, sha)
    manifest = parse(src_dir)
    # README code fences become the snippet stage, run in order after import.
    snip_dir = pkg_dir / "snippets"
    snip_dir.mkdir()
    for i, code in enumerate(manifest["snippets"][:MAX_SNIPPETS]):
        (snip_dir / f"{i:02d}.{snippet_ext(ecosystem, code)}").write_text(snippet_source(ecosystem, code), encoding="utf-8")

    docker_run(ecosystem, name, pkg_dir, deps_dir, events_dir, variant)

    raw = []
    hook_log = events_dir / "hook.jsonl"
    if hook_log.exists():
        raw = [json.loads(l) for l in hook_log.read_text(encoding="utf-8").splitlines() if l.strip()]
    events = to_events(raw, scan_id, variant, name)
    caps = capabilities(events)
    result = {
        "scan": scan_id, "package": name, "version": version, "sha256": sha,
        "source": "registry" if pkg_path.startswith(("npm:", "pypi:")) else "upload" if source else "local",
        "source_sha256": source,
        "ecosystem": ecosystem, "variant": variant,
        "events": events, "capabilities": caps,
        "claims": manifest, "diff": diff(caps, manifest),
    }
    out = ROOT / "scans" / f"{name}@{version}.{variant}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(result, indent=2), encoding="utf-8", newline="\n")
    return out, result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("package")
    ap.add_argument("--variant", default="baseline", choices=VARIANTS)
    a = ap.parse_args()
    out, res = scan(a.package, a.variant)
    d = res["diff"]
    print(f"{out}: verdict {d['verdict'].upper()} ({len(res['events'])} events)")
    for r in d["observed"]:
        print(f"  {r['severity']:8} {r['status']:12} {r['stage']:8} {r['cap']}  {r['reason']}")
