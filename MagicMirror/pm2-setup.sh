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

echo
echo "✓ MagicMirror je v pm2 (název: MagicMirror)."
echo "  Stav:    pm2 status MagicMirror"
echo "  Logy:    pm2 logs MagicMirror"
echo "  Restart: pm2 restart MagicMirror"
echo
echo "Pro autostart po startu OS spusť JEDNOU:"
echo "  pm2 startup        # vypíše příkaz se sudo — ten spusť"
echo "  (pm2 save už proběhlo)"
