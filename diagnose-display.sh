#!/usr/bin/env bash
# diagnose-display.sh — figure out why the mirror / live preview shows nothing.
# Run ON THE PI:  bash ~/smartMirror/diagnose-display.sh
set -uo pipefail

c() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }

c "1. Is MagicMirror running (pm2)?"
pm2 jlist 2>/dev/null | grep -q '"name":"MagicMirror"' \
  && pm2 status MagicMirror | sed -n '3,6p' \
  || bad "MagicMirror is not under pm2 — run ./deploy.sh"

c "2. Does :8080 allow framing? (iframe needs NO X-Frame-Options)"
hdr="$(curl -sI http://127.0.0.1:8080 2>/dev/null)"
if echo "$hdr" | grep -qi 'x-frame-options'; then
  bad "X-Frame-Options IS present → the app preview will be black."
  echo "$hdr" | grep -i 'x-frame-options' | sed 's/^/      /'
  warn "Fix: pm2 restart MagicMirror   (frameguard:false in config.js only takes effect after a restart)"
else
  echo "$hdr" | head -1 | sed 's/^/      /'
  ok "No X-Frame-Options — the iframe can render."
fi

c "3. Is the broker up? (profile core needs MQTT :1883)"
systemctl is-active --quiet mosquitto && ok "mosquitto running" || bad "mosquitto NOT running → the core stays stuck 'asleep', layout never redraws"

c "4. Current profile state (last push in MagicMirror logs)"
laststate="$(pm2 logs MagicMirror --nostream --lines 400 2>/dev/null | grep '\[Profile\] push' | tail -1)"
[ -n "$laststate" ] && echo "      $laststate" || warn "no [Profile] push in the log (no event yet?)"
echo "$laststate" | grep -q 'layout=\[\]' && bad "Resolved layout is EMPTY → the mirror is black (see step 5/6)."

c "5. Is config/pages.js valid and non-empty?"
PAGES=~/smartMirror/MagicMirror/config/pages.js
if [ -f "$PAGES" ]; then
  node -e "const p=require('$PAGES'); const d=p.defaults||{}; const k=Object.keys(d); console.log('  defaults for:', k.join(', ')||'(none)'); for(const u of k){const n=(d[u]||[]).length; console.log('   -',u,'→',n,'widgets'); }" \
    || bad "pages.js cannot be loaded (syntax error) → layout=[] → black mirror"
else
  bad "config/pages.js DOES NOT EXIST → no layout → black mirror. Save a scene in the app (generates pages.js)."
fi

c "6. Recovery — restore live layout right now"
echo "      mosquitto_pub -t smartmirror/profile/reload -m 1   # reloads pages.js + redraws"
echo "      mosquitto_pub -t smartmirror/radar/presence -m present   # wakes the mirror"

c "Summary"
echo "  • Black PREVIEW in the app, but the mirror is fine   → step 2 (restart MagicMirror: ./deploy.sh)."
echo "  • The MIRROR itself is black                          → step 3/4/5 (broker / empty layout / missing pages.js)."
