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
import tomllib
from pathlib import Path

import yaml

PRIORS = yaml.safe_load((Path(__file__).parent / "category_priors.yaml").read_text(encoding="utf-8"))

# Fences open and close at the start of a line; the info string can be
# anything (```sh-session, ```js title="x"), only its first word is the language.
FENCE = re.compile(r"^[ \t]*```([\w+-]*)[^\n]*\n(.*?)^[ \t]*```", re.S | re.M)
SNIPPET_LANGS = {"npm": {"", "js", "javascript", "node"}, "python": {"", "py", "python"}}
URL = re.compile(r"https?://([A-Za-z0-9.-]+)")
# Sentence boundary: punctuation followed by whitespace, or a newline (not the dots in URLs or `.env`).
SENTENCE = re.compile(r"(?<=[.!?])\s+|\n")
# Markdown links and images: [text](url), ![alt](url), and bare <url>.
MD_LINK = re.compile(r"!?\[[^\]]*\]\([^)]*\)|<https?://[^>]+>")
BACKTICK = re.compile(r"`([^`\n]+)`")
ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")
CODE_ENV = re.compile(r"process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['\"]([A-Z][A-Z0-9_]+)['\"]\])"
                      r"|os\.(?:environ(?:\.get\(|\[)|getenv\()['\"]([A-Z][A-Z0-9_]+)['\"]")

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

# Shell-style `NAME=value cmd` in any code fence documents an env var.
SHELL_ENV = re.compile(r"(?:^|[\s$])([A-Z][A-Z0-9_]*(?:<[A-Z_]+>)?[A-Z0-9_]*)=", re.M)
# A backticked file name: dotfiles (.env, .npmrc) or anything with a path or extension.
FILE_NAME = re.compile(r"^(?:~/|\./|/)?(?:[\w-]+/)*\.?[\w-]+(?:\.[\w-]+)*$")

FAMILIES = ("network", "files", "env", "subprocess")


def _env_glob(name: str) -> str:
    """DOTENV_CONFIG_<OPTION> -> DOTENV_CONFIG_*"""
    return re.sub(r"<[^>]+>", "*", name)


def category(meta: dict) -> str:
    words = " ".join([meta.get("name", ""), meta.get("description", ""), *meta.get("keywords", [])]).lower()
    best, score = "string-utils", 0
    for name, c in PRIORS["categories"].items():
        s = sum(1 for k in c["keywords"] if k in words)
        if s > score:
            best, score = name, s
    return best


def load_meta(pkg_dir: Path) -> tuple[str, dict]:
    """(ecosystem, metadata with name/version/description/keywords)."""
    if (pkg_dir / "package.json").exists():
        return "npm", json.loads((pkg_dir / "package.json").read_text(encoding="utf-8"))
    project = tomllib.loads((pkg_dir / "pyproject.toml").read_text(encoding="utf-8")).get("project", {})
    return "python", project


def parse(pkg_dir) -> dict:
    pkg_dir = Path(pkg_dir)
    ecosystem, meta = load_meta(pkg_dir)
    readme = ""
    for n in ("README.md", "readme.md", "README"):
        if (pkg_dir / n).exists():
            readme = (pkg_dir / n).read_text(encoding="utf-8", errors="replace")
            break
    snippets = [code for lang, code in FENCE.findall(readme) if lang.lower() in SNIPPET_LANGS[ecosystem]]
    prose = FENCE.sub("", readme) + "\n" + meta.get("description", "")
    m = {"network": [], "files": [], "env": [], "subprocess": [], "explicit_denials": [],
         "snippets": snippets, "ecosystem": ecosystem, "category": category(meta), "evidence": []}

    def add(family, cap, why):
        if cap not in m[family]:
            m[family].append(cap)
            m["evidence"].append({"cap": cap, "why": why})

    # Only URLs the package is said to talk to count: ones in code examples, or
    # in a sentence about making requests. Badges and doc links don't, otherwise
    # a README could "claim" any host just by linking to it.
    for code in snippets:
        for host in URL.findall(code):
            add("network", f"net:{host}", f"URL in README example: {host}")
    for sentence in SENTENCE.split(MD_LINK.sub("", prose)):
        if NET_PHRASES.search(sentence):
            for host in URL.findall(sentence):
                add("network", f"net:{host}", f"README says it talks to {host}")
    if NET_PHRASES.search(prose) and not m["network"]:
        add("network", "net:*", "README says it makes network requests")

    for sentence in SENTENCE.split(prose):
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
        for groups in CODE_ENV.findall(code):
            add("env", f"env:{next(g for g in groups if g)}", "used in README example")
        # File paths passed as string literals in examples, e.g. path: '.env.local'.
        for tok in re.findall(r"['\"]([^'\"\s]{3,})['\"]", code):
            if FILE_NAME.match(tok) and (tok.startswith((".", "~", "/")) or "/" in tok) and not tok.startswith(("./", "../")) or tok.startswith(("./.", "~/")):
                add("files", f"file:*:{tok}", f"README example uses file `{tok}`")
    for _, code in FENCE.findall(readme):
        for name in SHELL_ENV.findall(code):
            if "_" in name:
                add("env", f"env:{_env_glob(name)}", f"README shows `{name}=...`")
    for tok in BACKTICK.findall(prose):
        tok = tok.strip()
        if ENV_NAME.match(_env_glob(tok).replace("*", "X")) and "_" in tok:
            add("env", f"env:{_env_glob(tok)}", f"README names `{tok}`")
        elif FILE_NAME.match(tok) and (tok.startswith((".", "~", "/")) or "/" in tok) and len(tok) > 2:
            add("files", f"file:*:{tok}", f"README names file `{tok}`")

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
