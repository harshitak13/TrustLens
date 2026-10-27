"""Turn whatever the user hands us into a package directory the scanner understands.

Accepted:
  npm:<name>@<version>      fetched from the npm registry (npm pack, no scripts)
  pypi:<name>==<version>    wheel fetched from PyPI (pip download, binary only)
  path to a folder          containing package.json or pyproject.toml
  path to an upload         .tgz / .tar.gz / .zip of such a folder, or a .whl

Everything here runs on the host, so nothing from the package is executed:
archives are unpacked as data (tarfile "data" filter, zip paths checked) and
wheels are only read for their metadata. The package's code only ever runs
inside the sandbox.

A wheel has no source tree, so it becomes a small synthetic folder: README.md
from the wheel's long description, pyproject.toml from its metadata, and a
.tl-wheel marker naming the wheel file the sandbox should install.
"""
import email.parser
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

NPM = "npm.cmd" if os.name == "nt" else "npm"
MAX_UNPACKED = 200 * 1024 * 1024  # refuse zip bombs


def _run(cmd):
    return subprocess.run(cmd, check=True, text=True, capture_output=True)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _find_package_dir(root: Path) -> Path:
    """The folder holding package.json / pyproject.toml: the root or one level down."""
    for d in [root, *sorted(p for p in root.iterdir() if p.is_dir())]:
        if (d / "package.json").exists() or (d / "pyproject.toml").exists() or (d / ".tl-wheel").exists():
            return d
    raise ValueError("no package.json or pyproject.toml found in the upload")


def _unpack_tar(archive: Path, dest: Path):
    with tarfile.open(archive) as t:
        if sum(m.size for m in t.getmembers()) > MAX_UNPACKED:
            raise ValueError("archive too large")
        t.extractall(dest, filter="data")


def _unpack_zip(archive: Path, dest: Path):
    with zipfile.ZipFile(archive) as z:
        if sum(i.file_size for i in z.infolist()) > MAX_UNPACKED:
            raise ValueError("archive too large")
        root = dest.resolve()
        for info in z.infolist():
            target = (dest / info.filename).resolve()
            if not str(target).startswith(str(root)):
                raise ValueError(f"unsafe path in zip: {info.filename}")
        z.extractall(dest)


def wheel_to_dir(whl: Path, dest: Path) -> Path:
    """Synthetic package folder for a wheel (metadata + README, no code)."""
    with zipfile.ZipFile(whl) as z:
        meta_name = next(n for n in z.namelist() if n.endswith(".dist-info/METADATA"))
        msg = email.parser.Parser().parsestr(z.read(meta_name).decode("utf-8", "replace"))
    # Runtime dependencies only; extras ("; extra == ...") are optional.
    deps = [r for r in msg.get_all("Requires-Dist") or [] if "extra ==" not in r]
    project = {
        "name": msg["Name"], "version": msg["Version"], "description": msg.get("Summary") or "",
        "keywords": [k for k in re.split(r"[,\s]+", msg.get("Keywords") or "") if k],
        "dependencies": deps,
    }
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "README.md").write_text(msg.get_payload() or "", encoding="utf-8")
    lines = ["[project]"] + [f"{k} = {json.dumps(v)}" for k, v in project.items()]
    (dest / "pyproject.toml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    shutil.copy2(whl, dest / whl.name)
    (dest / ".tl-wheel").write_text(whl.name, encoding="utf-8")
    return dest


def resolve(spec: str, work: Path) -> tuple[Path, str | None]:
    """-> (package dir, sha256 of the original download/upload or None for a local folder)."""
    work.mkdir(parents=True, exist_ok=True)
    if spec.startswith("npm:"):
        res = _run([NPM, "pack", spec[4:], "--pack-destination", str(work), "--json", "--ignore-scripts"])
        tgz = work / json.loads(res.stdout)[0]["filename"]
        _unpack_tar(tgz, work / "unpacked")
        return work / "unpacked" / "package", _sha(tgz)
    if spec.startswith("pypi:"):
        _run([sys.executable, "-m", "pip", "download", spec[5:], "--no-deps", "--only-binary=:all:",
              "--platform", "manylinux2014_x86_64", "--platform", "manylinux_2_28_x86_64",
              "--python-version", "3.11", "--implementation", "cp", "--dest", str(work), "--quiet"])
        whl = next(work.glob("*.whl"))
        return wheel_to_dir(whl, work / "unpacked"), _sha(whl)

    path = Path(spec).resolve()
    if path.is_dir():
        return _find_package_dir(path), None
    name = path.name.lower()
    if name.endswith(".whl"):
        return wheel_to_dir(path, work / "unpacked"), _sha(path)
    if name.endswith((".tgz", ".tar.gz", ".tar")):
        _unpack_tar(path, work / "unpacked")
    elif name.endswith(".zip"):
        _unpack_zip(path, work / "unpacked")
    else:
        raise ValueError("upload a .tgz, .tar.gz, .zip or .whl")
    return _find_package_dir(work / "unpacked"), _sha(path)
