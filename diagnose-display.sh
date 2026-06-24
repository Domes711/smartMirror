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
  || bad "MagicMirror není pod pm2 — spusť ./deploy.sh"

c "2. Does :8080 allow framing? (iframe needs NO X-Frame-Options)"
hdr="$(curl -sI http://127.0.0.1:8080 2>/dev/null)"
if echo "$hdr" | grep -qi 'x-frame-options'; then
  bad "X-Frame-Options JE přítomno → app náhled bude černý."
  echo "$hdr" | grep -i 'x-frame-options' | sed 's/^/      /'
  warn "Oprava: pm2 restart MagicMirror   (frameguard:false v config.js se projeví až po restartu)"
else
  echo "$hdr" | head -1 | sed 's/^/      /'
  ok "Žádné X-Frame-Options — iframe se může vykreslit."
fi

c "3. Is the broker up? (profile core needs MQTT :1883)"
systemctl is-active --quiet mosquitto && ok "mosquitto běží" || bad "mosquitto NEběží → core uvízne 'asleep', layout se nepřekreslí"

c "4. Current profile state (last push in MagicMirror logs)"
laststate="$(pm2 logs MagicMirror --nostream --lines 400 2>/dev/null | grep '\[Profile\] push' | tail -1)"
[ -n "$laststate" ] && echo "      $laststate" || warn "žádný [Profile] push v logu (zatím žádná událost?)"
echo "$laststate" | grep -q 'layout=\[\]' && bad "Resolved layout je PRÁZDNÝ → zrcadlo je černé (viz krok 5/6)."

c "5. Is config/pages.js valid and non-empty?"
PAGES=~/smartMirror/MagicMirror/config/pages.js
if [ -f "$PAGES" ]; then
  node -e "const p=require('$PAGES'); const d=p.defaults||{}; const k=Object.keys(d); console.log('  defaults pro:', k.join(', ')||'(žádné)'); for(const u of k){const n=(d[u]||[]).length; console.log('   -',u,'→',n,'widgetů'); }" \
    || bad "pages.js se nedá načíst (syntax error) → layout=[] → černé zrcadlo"
else
  bad "config/pages.js NEEXISTUJE → žádné rozložení → černé zrcadlo. Ulož scénu v appce (vygeneruje pages.js)."
fi

c "6. Recovery — restore live layout right now"
echo "      mosquitto_pub -t smartmirror/profile/reload -m 1   # znovu načte pages.js + překreslí"
echo "      mosquitto_pub -t smartmirror/radar/presence -m present   # probudí zrcadlo"

c "Shrnutí"
echo "  • Černý NÁHLED v appce, ale zrcadlo OK   → krok 2 (restartuj MagicMirror: ./deploy.sh)."
echo "  • Černé i ZRCADLO                          → krok 3/4/5 (broker / prázdný layout / chybí pages.js)."
