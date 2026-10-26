"""Observed capabilities x claims manifest -> per-row status, severity, verdict.

Status per observed capability:
  claimed      matches the claims manifest
  expected     not claimed, but allowed by the category prior (for that stage)
  unclaimed    neither -> flagged
  contradicted the README explicitly denies that capability family
Verdict is the highest row severity.
"""
import re
from fnmatch import fnmatchcase

from claims.parse import PRIORS

SEVERITIES = ["none", "low", "medium", "high", "critical"]
FAMILY = {"net": "network", "file": "files", "env": "env", "proc": "subprocess"}

SENSITIVE_FILE = re.compile(r"^file:read:(~/\.ssh/|~/\.aws/|~/\.npmrc|~/\.netrc|~/\.config/gcloud|~/\.docker/config|.*/\.env$|/etc/shadow)")
SECRETISH_ENV = re.compile(r"(KEY|TOKEN|SECRET|PASS|CRED|AUTH|SESSION)", re.I)


def _matches(cap: str, patterns) -> bool:
    for p in patterns:
        if fnmatchcase(cap, p):
            return True
        # Claims for files are written as file:*:<path>; compare on the path.
        if p.startswith("file:*:") and cap.split(":", 2)[-1] == p[len("file:*:"):]:
            return True
    return False


def _prior_allows(cap: str, stage: str, category: str) -> bool:
    for rule in PRIORS["categories"].get(category, {}).get("allow", []):
        if fnmatchcase(cap, rule["cap"]) and stage in rule.get("stages", [stage]):
            return True
    return False


def _severity(cap: str, stage: str, status: str) -> tuple[str, str]:
    fam = cap.split(":", 1)[0]
    if status in ("claimed", "expected"):
        return "none", ""
    if status == "contradicted":
        if fam in ("net", "proc") or SENSITIVE_FILE.match(cap):
            return "critical", "README explicitly says it doesn't do this"
        return "medium", "README says it doesn't do this (minor capability)"
    if SENSITIVE_FILE.match(cap):
        return "high", "reads a credential-style file it never mentions"
    if fam == "proc":
        return ("high", "starts a process during install") if stage == "install" else ("medium", "starts an undocumented process")
    if fam == "net":
        return ("high", f"undocumented network call during {stage}") if stage in ("install", "import") \
            else ("medium", "undocumented network call")
    if fam == "env":
        name = cap.split(":", 1)[1]
        return ("medium", "reads a secret-looking env var") if SECRETISH_ENV.search(name) else ("low", "undocumented env read")
    if fam == "file" and cap.startswith("file:write:") and not cap.startswith("file:write:/work/"):
        return "medium", "writes outside its working directory"
    return "low", "undocumented"


def diff(observed: list[dict], manifest: dict) -> dict:
    category = manifest.get("category", "string-utils")
    rows = []
    for o in observed:
        cap, stage = o["cap"], o["stage"]
        fam = cap.split(":", 1)[0]
        if fam in manifest.get("explicit_denials", []):
            status = "contradicted"
        elif _matches(cap, manifest.get(FAMILY.get(fam, ""), [])):
            status = "claimed"
        elif _prior_allows(cap, stage, category):
            status = "expected"
        else:
            status = "unclaimed"
        sev, why = _severity(cap, stage, status)
        rows.append({**o, "status": status, "severity": sev, "reason": why})

    # Escalation: a sensitive file read plus any flagged network call is the
    # classic credential-theft shape.
    flagged = [r for r in rows if r["status"] in ("unclaimed", "contradicted")]
    if any(SENSITIVE_FILE.match(r["cap"]) for r in flagged) and any(r["cap"].startswith("net:") for r in flagged):
        for r in flagged:
            if SENSITIVE_FILE.match(r["cap"]) or r["cap"].startswith("net:"):
                r["severity"], r["reason"] = "critical", "credential-style file read combined with undocumented network"

    verdict = max((r["severity"] for r in rows), key=SEVERITIES.index, default="none")
    claimed = [{"cap": c, "family": fam, "seen": any(_matches(r["cap"], [c]) for r in rows)}
               for fam in ("network", "files", "env", "subprocess") for c in manifest.get(fam, [])]
    return {"verdict": verdict, "category": category, "claimed": claimed, "observed": rows,
            "denials": manifest.get("explicit_denials", [])}


def trigger_matrix(by_variant: dict[str, list[dict]]) -> dict:
    """variant -> capability set; anything absent from baseline is a finding."""
    sets = {v: {r["cap"] for r in caps} for v, caps in by_variant.items()}
    base = sets.get("baseline", set())
    caps = sorted(set().union(*sets.values())) if sets else []
    return {"variants": list(sets), "rows": [{"cap": c, **{v: c in s for v, s in sets.items()}} for c in caps],
            "findings": [{"variant": v, "cap": c} for v, s in sets.items() if v != "baseline" for c in sorted(s - base)],
            # The reverse: flagged-type behaviour that goes quiet in a variant
            # (e.g. stops phoning home under CI) suggests the package hides from it.
            "evasions": [{"variant": v, "cap": c} for v, s in sets.items() if v != "baseline"
                         for c in sorted(base - s) if c.startswith(("net:", "proc:"))]}
