"""TrustLens API.

  GET  /scans                 list cached results in scans/
  GET  /scan/{key}            one result, key = "<pkg>@<ver>"
  POST /scan {path, variants} start a scan job, returns {job}
  GET  /job/{job}/stream      SSE progress: one event per finished variant, then "done"

The demo only needs the GETs; they read the cached JSON in scans/.
Run: uvicorn api.main:app --reload --port 8000
"""
import asyncio
import json
import sys
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from diff.engine import SEVERITIES as SEVERITY_ORDER, trigger_matrix  # noqa: E402
from sandbox.run_scan import VARIANTS, scan  # noqa: E402

SCANS = ROOT / "scans"
app = FastAPI(title="TrustLens")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
JOBS: dict[str, dict] = {}


def summary(res: dict) -> dict:
    return {"key": f"{res['package']}@{res['version']}", "package": res["package"], "version": res["version"],
            "verdict": res["diff"]["verdict"], "category": res["diff"]["category"],
            "flagged": sum(r["status"] in ("unclaimed", "contradicted") for r in res["diff"]["observed"])}


def combine(results: dict[str, dict]) -> dict:
    """Baseline result + hunter matrix in one file: scans/<pkg>@<ver>.json."""
    base = results["baseline"]
    out = {**base, "variants": list(results),
           "matrix": trigger_matrix({v: r["capabilities"] for v, r in results.items()})}
    findings = out["matrix"]["findings"]
    if findings:
        # Behaviour that only switches on in a changed environment is a hidden trigger.
        sev = "critical" if any(f["cap"].startswith(("net:", "proc:")) for f in findings) else "high"
        if SEVERITY_ORDER.index(sev) > SEVERITY_ORDER.index(base["diff"]["verdict"]):
            out["diff"] = {**base["diff"], "verdict": sev}
    (SCANS / f"{base['package']}@{base['version']}.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    return out


def run_job(job_id: str, path: str, variants: list[str]):
    job = JOBS[job_id]
    results = {}
    try:
        for v in ["baseline"] + [x for x in variants if x != "baseline"]:
            job["events"].append({"stage": v, "state": "running"})
            _, results[v] = scan(path, v)
            job["events"].append({"stage": v, "state": "done", "verdict": results[v]["diff"]["verdict"]})
        job["result"] = summary(combine(results))
        job["events"].append({"stage": "all", "state": "done", "key": job["result"]["key"]})
    except Exception as e:  # surface failures to the progress strip
        job["events"].append({"stage": "error", "state": "failed", "error": str(e)})
    job["finished"] = True


class ScanRequest(BaseModel):
    path: str
    variants: list[str] = list(VARIANTS)


@app.get("/scans")
def list_scans():
    # Combined files are <pkg>@<ver>.json; per-variant ones end in .<variant>.json.
    variant_suffix = tuple(f".{v}" for v in VARIANTS)
    return [summary(json.loads(f.read_text(encoding="utf-8")))
            for f in sorted(SCANS.glob("*.json")) if not f.stem.endswith(variant_suffix)]


@app.get("/fixtures")
def list_fixtures():
    return sorted(f"fixtures/{d.name}" for d in (ROOT / "fixtures").iterdir() if (d / "package.json").exists())


@app.get("/scan/{key}")
def get_scan(key: str):
    f = SCANS / f"{key}.json"
    if not f.exists():
        f = SCANS / f"{key}.baseline.json"
    if not f.exists() or f.resolve().parent != SCANS.resolve():
        raise HTTPException(404, "no such scan")
    return json.loads(f.read_text(encoding="utf-8"))


@app.post("/scan")
def start_scan(req: ScanRequest):
    bad = [v for v in req.variants if v not in VARIANTS]
    if bad:
        raise HTTPException(400, f"unknown variants: {bad}")
    if not (Path(req.path) / "package.json").exists() and not (ROOT / req.path / "package.json").exists():
        raise HTTPException(400, "path must be a package directory")
    path = req.path if Path(req.path).is_absolute() else str(ROOT / req.path)
    job_id = uuid.uuid4().hex[:8]
    JOBS[job_id] = {"events": [], "finished": False, "result": None}
    threading.Thread(target=run_job, args=(job_id, path, req.variants), daemon=True).start()
    return {"job": job_id}


@app.get("/job/{job_id}/stream")
async def stream(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "no such job")

    async def gen():
        sent = 0
        while True:
            job = JOBS[job_id]
            while sent < len(job["events"]):
                yield f"data: {json.dumps(job['events'][sent])}\n\n"
                sent += 1
            if job["finished"] and sent >= len(job["events"]):
                return
            await asyncio.sleep(0.3)

    return StreamingResponse(gen(), media_type="text/event-stream")
