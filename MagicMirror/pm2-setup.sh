#!/bin/bash
# pm2-setup.sh — register MagicMirror in pm2 via the start wrapper.
#
# Runs the start-magicmirror.sh wrapper (DISPLAY, X wait, unclutter, npm start)
# under pm2 as the process named "MagicMirror" — the same name the console's
# layout editor restarts via `pm2 restart MagicMirror`.
#
# Usage (on the Pi):
#   cd ~/MagicMirror && ./pm2-setup.sh
#   pm2 startup        # run once, then run the sudo command it prints (boot autostart)
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

chmod +x start-magicmirror.sh

# replace any existing instance, then start fresh under the canonical name
pm2 delete MagicMirror 2>/dev/null || true
pm2 start ./start-magicmirror.sh --name MagicMirror

# persist the process list so `pm2 resurrect` (on boot) brings it back
pm2 save

# install the boot hook (systemd) non-interactively so it autostarts on reboot
echo "▸ Registering pm2 boot autostart…"
NODE_BIN_DIR="$(dirname "$(command -v node)")"
sudo env PATH="$PATH:$NODE_BIN_DIR" "$(command -v pm2)" startup systemd \
  -u "$(id -un)" --hp "$HOME" || \
  echo "  (pm2 startup selhal — spusť ručně: pm2 startup a vypsaný sudo příkaz)"
pm2 save

echo
echo "✓ MagicMirror je v pm2 (název: MagicMirror) + autostart po rebootu."
echo "  Stav:    pm2 status MagicMirror"
echo "  Logy:    pm2 logs MagicMirror"
echo "  Restart: pm2 restart MagicMirror"
