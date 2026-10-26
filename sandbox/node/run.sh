#!/bin/sh
# Runs inside the sandbox. Stages: install -> import (snippet comes later).
# Stage markers go into the hook log so the host can place sink events by time.
set -u
EV=/events/hook.jsonl
mark() { printf '{"type":"stage","stage":"%s","t":%s}\n' "$1" "$(date +%s%3N)" >> "$EV"; }

export TL_EVENTS="$EV"
export NODE_OPTIONS="--require /trustlens/node-hook.js"
cd /work
printf '{"name":"tl-scan","version":"0.0.0","private":true}\n' > package.json

mark install
TL_STAGE=install timeout 45 npm install --no-audit --no-fund --offline \
  --no-package-lock /pkg/pkg.tgz > /events/install.log 2>&1
echo "install exit $?" >> /events/install.log

mark import
# Keep the process alive a few seconds so delayed/async behaviour shows up.
TL_STAGE=import timeout 20 node -e "require(process.env.TL_PKG_NAME); setTimeout(()=>{}, 4000)" \
  > /events/import.log 2>&1
echo "import exit $?" >> /events/import.log

mark done
