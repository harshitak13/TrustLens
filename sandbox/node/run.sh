#!/bin/sh
# Runs inside the sandbox. Stages: install -> import -> snippet.
# Stage markers go into the hook log so the host can assign events to stages.
set -u
EV=/events/hook.jsonl
mark() { printf '{"type":"stage","stage":"%s","t":%s}\n' "$1" "$(date +%s%3N)" >> "$EV"; }

export TL_EVENTS="$EV"
export NODE_OPTIONS="--require /trustlens/node-hook.js"
cd /work
printf '{"name":"tl-scan","version":"0.0.0","private":true}\n' > package.json

# Dependencies were downloaded outside the sandbox (no scripts run) into an
# npm cache; copy it somewhere writable so `npm install --offline` can use it.
if [ -d /deps/npmcache ]; then cp -r /deps/npmcache /tmp/.npm; fi

mark install
TL_STAGE=install timeout 120 npm install --no-audit --no-fund --offline \
  --no-package-lock /pkg/pkg.tgz > /events/install.log 2>&1
echo "install exit $?" >> /events/install.log

mark import
# import() loads both CommonJS and ESM-only packages. Stay alive a few seconds
# so delayed/async behaviour shows up.
TL_STAGE=import timeout 20 node -e "import(process.env.TL_PKG_NAME).catch(e => { console.error(e); process.exitCode = 1 }); setTimeout(()=>{}, 4000)" \
  > /events/import.log 2>&1
echo "import exit $?" >> /events/import.log

mark snippet
for f in /pkg/snippets/*.js /pkg/snippets/*.mjs; do
  [ -e "$f" ] || continue
  ext="${f##*.}"
  cp "$f" "/work/snippet.$ext"
  TL_STAGE=snippet timeout 8 node "/work/snippet.$ext" >> /events/snippet.log 2>&1
  echo "$f exit $?" >> /events/snippet.log
done

mark done
