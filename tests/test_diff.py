"""Diff engine on the fixtures with hand-written observations (no Docker needed)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from claims.parse import parse  # noqa: E402
from diff.engine import diff, trigger_matrix  # noqa: E402


def obs(*pairs):
    return [{"cap": c, "stage": s, "first_ts": 0, "count": 1} for s, c in pairs]


def test_pad_clean_is_clean_and_denies_io():
    m = parse(ROOT / "fixtures/pad-clean")
    assert m["category"] == "string-utils"
    assert set(m["explicit_denials"]) >= {"net", "file", "env"}
    assert diff([], m)["verdict"] == "none"


def test_pad_clean_network_is_contradicted():
    d = diff(obs(("import", "net:evil.test")), parse(ROOT / "fixtures/pad-clean"))
    assert d["observed"][0]["status"] == "contradicted"
    assert d["verdict"] == "critical"


def test_http_fetchy_import_ping_is_flagged():
    m = parse(ROOT / "fixtures/http-fetchy")
    assert m["category"] == "http-client"
    assert "env:FETCHY_TIMEOUT" in m["env"]
    d = diff(obs(("import", "env:FETCHY_TIMEOUT"), ("import", "net:status.http-fetchy.test"),
                 ("snippet", "net:example.test")), m)
    status = {r["cap"]: r["status"] for r in d["observed"]}
    assert status == {"env:FETCHY_TIMEOUT": "claimed", "net:status.http-fetchy.test": "unclaimed",
                      "net:example.test": "claimed"}
    assert d["verdict"] == "high"


def test_sensitive_read_plus_net_escalates():
    m = parse(ROOT / "fixtures/http-fetchy")
    d = diff(obs(("import", "file:read:~/.ssh/id_rsa"), ("import", "net:x.test")), m)
    assert d["verdict"] == "critical"


def test_trigger_matrix():
    t = trigger_matrix({"baseline": obs(("import", "env:A")), "ci": obs(("import", "env:A"), ("import", "net:c.test"))})
    assert t["findings"] == [{"variant": "ci", "cap": "net:c.test"}]


def test_python_fixture_claims():
    m = parse(ROOT / "fixtures/py-titlecase")
    assert m["ecosystem"] == "python" and m["category"] == "string-utils"
    assert "net" in m["explicit_denials"]
    assert len(m["snippets"]) == 1


def test_bare_file_claim_matches_any_directory():
    m = {"files": ["file:*:.env"], "category": "string-utils"}
    rows = diff(obs(("snippet", "file:read:/work/.env"), ("snippet", "file:read:/work/x.env")), m)["observed"]
    assert [r["status"] for r in rows] == ["claimed", "unclaimed"]


def test_readme_links_are_not_network_claims(tmp_path):
    (tmp_path / "package.json").write_text('{"name": "x", "version": "1.0.0"}')
    (tmp_path / "README.md").write_text(
        "# x\n[![badge](https://img.shields.io/x)](https://evil.test/a)\nSee https://docs.test/ for docs.\n"
        "It makes requests to https://api.good.test/v1.\n```js\nfetch('https://ex.test/')\n```\n")
    m = parse(tmp_path)
    assert set(m["network"]) == {"net:ex.test", "net:api.good.test"}
