"""Full scan: baseline + every hunter variant, combined into scans/<pkg>@<ver>.json.

Usage: python scripts/scan.py fixtures/http-fetchy [fixtures/pad-clean ...]
"""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.main import JOBS, VARIANTS, run_job  # noqa: E402

for path in sys.argv[1:]:
    job = uuid.uuid4().hex[:8]
    JOBS[job] = {"events": [], "finished": False, "result": None}
    run_job(job, str(Path(path).resolve()), list(VARIANTS))
    for e in JOBS[job]["events"]:
        if e["state"] != "running":
            print(path, e)
