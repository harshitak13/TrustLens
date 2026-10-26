"""Run one npm or Python package through the sandbox and write scans/<pkg>@<ver>.json.

Usage: python sandbox/run_scan.py fixtures/pad-clean [--variant baseline|ci|later|host|user]
       python sandbox/run_scan.py npm:left-pad@1.3.0

Host side, stdlib only. Packs the package (recording its sha256), runs it in a
locked-down container with networking off, then turns the hook log into the
event schema plus capability strings for the diff engine.
"""
import argparse
import hashlib
import json
import os
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

ROOT = Path(__file__).resolve().parent.parent
NPM = "npm.cmd" if os.name == "nt" else "npm"
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


def fetch_npm(spec: str, out: Path) -> tuple[Path, str]:
    """Download a registry tarball (outside the sandbox, no scripts run) and
    unpack it as data so the claims parser can read package.json and README.
    Returns (unpacked package dir, sha256 of the registry tarball)."""
    dl = out / "download"
    dl.mkdir()
    res = run([NPM, "pack", spec, "--pack-destination", str(dl), "--json", "--ignore-scripts"])
    tgz = dl / json.loads(res.stdout)[0]["filename"]
    with tarfile.open(tgz) as t:
        t.extractall(dl / "unpacked", filter="data")
    return dl / "unpacked" / "package", hashlib.sha256(tgz.read_bytes()).hexdigest()


def docker_run(ecosystem, name, pkg_dir: Path, events_dir: Path, variant: str):
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
           *mount(events_dir, "/events", False),
           "-e", f"TL_PKG_NAME={name}", "-e", f"TL_PKG_IMPORT={name.replace('-', '_')}", *extra_args]
    for k, v in extra_env.items():
        cmd += ["-e", f"{k}={v}"]
    cmd += [image, "sh", "/trustlens/run.sh"]
    subprocess.run(cmd, check=False, timeout=120)


def scan(pkg_path: str, variant: str = "baseline"):
    scan_id = uuid.uuid4().hex[:10]
    base = WORK / "runs" / scan_id
    pkg_dir, events_dir = base / "pkg", base / "events"
    pkg_dir.mkdir(parents=True)
    events_dir.mkdir()
    source = None
    if pkg_path.startswith("npm:"):
        src_dir, source = fetch_npm(pkg_path[4:], base)
    else:
        src_dir = Path(pkg_path).resolve()
    ecosystem, name, version, sha = pack(src_dir, pkg_dir)
    manifest = parse(src_dir)
    # README code fences become the snippet stage, run in order after import.
    snip_dir = pkg_dir / "snippets"
    snip_dir.mkdir()
    for i, code in enumerate(manifest["snippets"]):
        (snip_dir / f"{i:02d}.{ECOSYSTEMS[ecosystem][2]}").write_text(code, encoding="utf-8")

    docker_run(ecosystem, name, pkg_dir, events_dir, variant)

    raw = []
    hook_log = events_dir / "hook.jsonl"
    if hook_log.exists():
        raw = [json.loads(l) for l in hook_log.read_text(encoding="utf-8").splitlines() if l.strip()]
    events = to_events(raw, scan_id, variant, name)
    caps = capabilities(events)
    result = {
        "scan": scan_id, "package": name, "version": version, "sha256": sha,
        "source": "registry" if source else "local", "registry_sha256": source,
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
