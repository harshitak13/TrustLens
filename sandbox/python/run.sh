#!/bin/sh
# Runs inside the sandbox. Stages: install -> import -> snippet, like the npm one.
set -u
EV=/events/hook.jsonl
mark() { printf '{"type":"stage","stage":"%s","t":%s}\n' "$1" "$(date +%s%3N)" >> "$EV"; }

export TL_EVENTS="$EV"
# sitecustomize.py on PYTHONPATH loads the hook into every python process;
# /work/site is where the package is installed.
export PYTHONPATH="/trustlens:/work/site"
cp -r /pkg/src /work/src

# "later" variant: Python has no in-process clock patch like the Node hook,
# so shift the whole sandbox clock with libfaketime.
if [ -n "${TL_FAKE_DATE:-}" ]; then
  export LD_PRELOAD=/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1
  export FAKETIME="@$(echo "$TL_FAKE_DATE" | sed 's/T/ /; s/Z$//')"
  export FAKETIME_DONT_FAKE_MONOTONIC=1
fi

mark install
TL_STAGE=install timeout 60 python -m pip install --no-index --no-build-isolation \
  --target /work/site /work/src > /events/install.log 2>&1
echo "install exit $?" >> /events/install.log

mark import
TL_STAGE=import timeout 20 python -c "import importlib, os, time; importlib.import_module(os.environ['TL_PKG_IMPORT']); time.sleep(4)" \
  > /events/import.log 2>&1
echo "import exit $?" >> /events/import.log

mark snippet
for f in /pkg/snippets/*.py; do
  [ -e "$f" ] || continue
  cp "$f" /work/snippet.py
  TL_STAGE=snippet timeout 20 python /work/snippet.py >> /events/snippet.log 2>&1
  echo "$f exit $?" >> /events/snippet.log
done

mark done
