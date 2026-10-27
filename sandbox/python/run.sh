#!/bin/sh
# Runs inside the sandbox. Stages: install -> import -> snippet, like the npm one.
set -u
EV=/events/hook.jsonl
mark() { printf '{"type":"stage","stage":"%s","t":%s}\n' "$1" "$(date +%s%3N)" >> "$EV"; }

export TL_EVENTS="$EV"
# sitecustomize.py on PYTHONPATH loads the hook into every python process;
# /work/site is where the package is installed.
export PYTHONPATH="/trustlens:/work/site"
if [ -d /pkg/src ]; then cp -r /pkg/src /work/src; fi

# "later" variant: Python has no in-process clock patch like the Node hook,
# so shift the whole sandbox clock with libfaketime.
if [ -n "${TL_FAKE_DATE:-}" ]; then
  export LD_PRELOAD=/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1
  export FAKETIME="@$(echo "$TL_FAKE_DATE" | sed 's/T/ /; s/Z$//')"
  export FAKETIME_DONT_FAKE_MONOTONIC=1
fi

mark install
# Dependency wheels (if any) were downloaded outside the sandbox into /deps/wheels.
# A wheel (PyPI or upload) is installed as-is; otherwise build from the source copy.
TARGET=/work/src
for w in /pkg/wheel/*.whl; do [ -e "$w" ] && TARGET="$w"; done
TL_STAGE=install timeout 120 python -m pip install --no-index --no-build-isolation \
  --find-links /deps/wheels --target /work/site "$TARGET" > /events/install.log 2>&1
echo "install exit $?" >> /events/install.log

mark import
TL_STAGE=import timeout 20 python /trustlens/import_pkg.py > /events/import.log 2>&1
echo "import exit $?" >> /events/import.log

mark snippet
for f in /pkg/snippets/*.py; do
  [ -e "$f" ] || continue
  cp "$f" /work/snippet.py
  TL_STAGE=snippet timeout 8 python /work/snippet.py >> /events/snippet.log 2>&1
  echo "$f exit $?" >> /events/snippet.log
done

mark done
