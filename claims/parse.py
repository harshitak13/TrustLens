"""README + package.json -> claims manifest.

Manifest: {network: [], files: [], env: [], subprocess: [], explicit_denials: [],
           snippets: [], category: str}
Entries in network/files/env/subprocess are capability globs (net:example.test,
env:FETCHY_TIMEOUT, ...). explicit_denials holds capability families the README
says the package never uses: net, file, env, proc.

Rules only, so it is deterministic. An LLM pass can add entries later, but its
output must go through validate() and it never decides the verdict.
"""
import json
import re
from pathlib import Path

import yaml

PRIORS = yaml.safe_load((Path(__file__).parent / "category_priors.yaml").read_text(encoding="utf-8"))

FENCE = re.compile(r"```[a-zA-Z]*\n(.*?)```", re.S)
URL = re.compile(r"https?://([A-Za-z0-9.-]+)")
BACKTICK = re.compile(r"`([^`\n]+)`")
ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")
CODE_ENV = re.compile(r"process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['\"]([A-Z][A-Z0-9_]+)['\"]\])")

NET_PHRASES = re.compile(r"\b(http request|https request|makes? (?:a |an )?requests?|fetch(?:es)?|downloads?|"
                         r"calls? (?:the|an?) api|sends? (?:data|telemetry)|connects? to)\b", re.I)
ENV_PHRASES = re.compile(r"\b(environment|env var|env\b|reads? `|requires? `)", re.I)
PROC_PHRASES = re.compile(r"\b(spawns?|executes?|runs? (?:the )?`|shells? out|child process)", re.I)
FILE_PHRASES = re.compile(r"\b(reads? (?:a |the |your )?(?:config|file)|writes? (?:a |the )?file|config file)", re.I)

DENIALS = [
    ("net", re.compile(r"\b(no network|no http|never (?:makes|sends|connects)|offline|no i/o|pure function)", re.I)),
    ("file", re.compile(r"\b(no file|no filesystem|no disk|no i/o|pure function)", re.I)),
    ("env", re.compile(r"\b(no environment variables?|no env|pure function)", re.I)),
    ("proc", re.compile(r"\b(no (?:child )?process|no subprocess|never spawns|pure function)", re.I)),
]

FAMILIES = ("network", "files", "env", "subprocess")


def category(meta: dict) -> str:
    words = " ".join([meta.get("name", ""), meta.get("description", ""), *meta.get("keywords", [])]).lower()
    best, score = "string-utils", 0
    for name, c in PRIORS["categories"].items():
        s = sum(1 for k in c["keywords"] if k in words)
        if s > score:
            best, score = name, s
    return best


def parse(pkg_dir) -> dict:
    pkg_dir = Path(pkg_dir)
    meta = json.loads((pkg_dir / "package.json").read_text(encoding="utf-8"))
    readme = ""
    for n in ("README.md", "readme.md", "README"):
        if (pkg_dir / n).exists():
            readme = (pkg_dir / n).read_text(encoding="utf-8", errors="replace")
            break
    snippets = FENCE.findall(readme)
    prose = FENCE.sub("", readme) + "\n" + meta.get("description", "")
    m = {"network": [], "files": [], "env": [], "subprocess": [], "explicit_denials": [],
         "snippets": snippets, "category": category(meta), "evidence": []}

    def add(family, cap, why):
        if cap not in m[family]:
            m[family].append(cap)
            m["evidence"].append({"cap": cap, "why": why})

    for host in URL.findall(readme):
        add("network", f"net:{host}", f"URL in README: {host}")
    if NET_PHRASES.search(prose) and not m["network"]:
        add("network", "net:*", "README says it makes network requests")

    for sentence in re.split(r"(?<=[.!?\n])", prose):
        if ENV_PHRASES.search(sentence):
            for name in BACKTICK.findall(sentence):
                if ENV_NAME.match(name):
                    add("env", f"env:{name}", f"README mentions env `{name}`")
        if PROC_PHRASES.search(sentence):
            for cmd in BACKTICK.findall(sentence):
                add("subprocess", f"proc:{cmd.split()[0]}", f"README says it runs `{cmd}`")
        if FILE_PHRASES.search(sentence):
            for path in BACKTICK.findall(sentence):
                if "/" in path or path.startswith((".", "~")):
                    add("files", f"file:*:{path}", f"README mentions file `{path}`")
    for code in snippets:
        for a, b in CODE_ENV.findall(code):
            add("env", f"env:{a or b}", "used in README example")

    for fam, rx in DENIALS:
        if rx.search(prose):
            m["explicit_denials"].append(fam)
    return validate(m)


def validate(m: dict) -> dict:
    """Drop anything that isn't a well-formed capability glob (also used on LLM output)."""
    prefix = {"network": "net:", "files": "file:", "env": "env:", "subprocess": "proc:"}
    out = dict(m)
    for fam in FAMILIES:
        out[fam] = [c for c in m.get(fam, []) if isinstance(c, str) and c.startswith(prefix[fam]) and len(c) < 300]
    out["explicit_denials"] = [d for d in m.get("explicit_denials", []) if d in ("net", "file", "env", "proc")]
    return out


if __name__ == "__main__":
    import sys
    print(json.dumps(parse(sys.argv[1]), indent=2))
