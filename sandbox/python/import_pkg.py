"""Import the scanned distribution's own top-level modules (not its deps).

The import name often differs from the distribution name (beautifulsoup4 ->
bs4), so read the installed dist-info RECORD to find what it provides.
"""
import importlib
import os
import re
import sys
import time

site = "/work/site"
want = re.sub(r"[-_.]+", "_", os.environ["TL_PKG_NAME"]).lower()
modules = set()
for d in os.listdir(site):
    if d.endswith(".dist-info") and re.sub(r"[-_.]+", "_", d.rsplit("-", 1)[0]).lower() == want:
        with open(os.path.join(site, d, "RECORD"), encoding="utf-8") as f:
            for line in f:
                top = line.split(",", 1)[0].split("/", 1)[0]
                if top.endswith(".py"):
                    top = top[:-3]
                if top and not top.endswith((".dist-info", ".data")) and top not in ("__pycache__", "bin", "..") and top.isidentifier():
                    modules.add(top)
if not modules:
    modules.add(os.environ.get("TL_PKG_IMPORT", want))
for m in sorted(modules):
    try:
        importlib.import_module(m)
    except Exception as e:
        print(f"import {m} failed: {e!r}", file=sys.stderr)
time.sleep(4)
