"""Intake must never write outside its work dir, whatever the upload contains."""
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sandbox import intake  # noqa: E402


def test_zip_with_parent_path_is_refused(tmp_path):
    z = tmp_path / "evil.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("../escape.txt", "x")
    with pytest.raises(ValueError):
        intake.resolve(str(z), tmp_path / "work")
    assert not (tmp_path / "escape.txt").exists()


def test_zip_of_package_folder_is_found(tmp_path):
    z = tmp_path / "ok.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("mylib/package.json", '{"name": "mylib", "version": "1.0.0"}')
        f.writestr("mylib/index.js", "module.exports = 1")
    pkg, sha = intake.resolve(str(z), tmp_path / "work")
    assert (pkg / "package.json").exists() and len(sha) == 64


def test_unknown_upload_type_is_refused(tmp_path):
    f = tmp_path / "app.exe"
    f.write_bytes(b"MZ")
    with pytest.raises(ValueError):
        intake.resolve(str(f), tmp_path / "work")
