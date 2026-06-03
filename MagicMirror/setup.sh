#!/bin/bash
# setup.sh — one-shot MagicMirror bring-up after a fresh git clone.
#
# Installs the MagicMirror core dependencies AND each module's own
# node_modules, makes the start scripts executable, and (if pm2 is available)
# registers the mirror in pm2 via pm2-setup.sh.
#
# Usage (on the Pi):
#   git clone <repo> && cd <repo>/MagicMirror && ./setup.sh
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "▸ MagicMirror: $DIR"

echo "▸ Installing core dependencies…"
# prod-only install (MagicMirror's own helper script)
npm run install-mm

echo "▸ Installing module dependencies…"
for mod in modules/*/; do
  if [ -f "$mod/package.json" ]; then
    echo "  • $mod"
    ( cd "$mod" && npm install --no-audit --no-fund )
  fi
done

echo "▸ Making start scripts executable…"
chmod +x start-magicmirror.sh pm2-setup.sh 2>/dev/null || true

# Splice console-modules.js into config.js so console-created modules load.
# Idempotent (skips if already present), backs up, validates, reverts on break.
CFG="$DIR/config/config.js"
if [ -f "$CFG" ] && grep -q "modules:" "$CFG" && ! grep -q "console-modules" "$CFG"; then
  echo "▸ Splicing console-modules.js into config.js…"
  BK="$CFG.bak.$(date +%s)"
  cp "$CFG" "$BK"
  sed -i '0,/let config = {/s//const consoleModules = (() => { try { return require(".\/console-modules.js"); } catch (e) { return []; } })();\n\nlet config = {/' "$CFG"
  sed -i '0,/modules:[[:space:]]*\[/s//modules: [\n    ...consoleModules,/' "$CFG"
  if node -e "require('$CFG')" >/dev/null 2>&1; then
    echo "  ✓ config.js upraven (záloha: $BK)"
  else
    echo "  ✗ úprava rozbila config.js — vracím zálohu"
    mv "$BK" "$CFG"
  fi
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "▸ Registering in pm2…"
  ./pm2-setup.sh
else
  echo
  echo "✓ Dependencies installed."
  echo "  pm2 nenalezen — nainstaluj ho (npm i -g pm2) a spusť ./pm2-setup.sh,"
  echo "  nebo zrcadlo spusť ručně: ./start-magicmirror.sh"
fi
