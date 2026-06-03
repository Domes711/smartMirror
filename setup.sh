#!/bin/bash
# setup.sh — master installer for the whole smart mirror.
#
# Fresh Pi flow:
#   git clone <repo> smartMirror
#   cd smartMirror && ./setup.sh
#
# Runs each component's own setup.sh (camera, radar, console, MagicMirror) and
# installs the sudoers rule that lets the console control the daemons.
#
# NOTE: components are independent — a failure in one (e.g. a slow dlib/mediapipe
# build in camera) must NOT abort the rest, so MagicMirror still comes up.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

FAILED=""
run() {  # run "Label" /path/to/setup.sh
  echo
  echo "── $1 ──"
  if bash "$2"; then echo "✓ $1"; else echo "✗ $1 — pokračuji (viz chyba výše)"; FAILED="$FAILED $1"; fi
}

echo "════════════════════════════════════════════"
echo "  Smart Mirror — master setup ($DIR)"
echo "════════════════════════════════════════════"

echo
echo "── sudoers (console controls face_reco / ld2450) ──"
sudo cp "$DIR/mirror-console/sudoers.d/mirror-console" /etc/sudoers.d/mirror-console || true
sudo visudo -cf /etc/sudoers.d/mirror-console || true

run "1/4  Camera (face recognition)" "$DIR/camera/setup.sh"
run "2/4  Radar (LD2450)"            "$DIR/ld2450/setup.sh"
run "3/4  Mirror console"            "$DIR/mirror-console/setup.sh"
run "4/4  MagicMirror (+ pm2)"       "$DIR/MagicMirror/setup.sh"

echo
echo "════════════════════════════════════════════"
if [ -n "$FAILED" ]; then
  echo "  ⚠ Dokončeno s chybami v:$FAILED"
  echo "    (ostatní části běží; chybnou část oprav a spusť její setup.sh zvlášť)"
else
  echo "  ✓ Hotovo."
fi
echo "════════════════════════════════════════════"
echo "Automatizováno: sudoers, UART (raspi-config), config.js spread, pm2 autostart."
echo
echo "Ruční (citlivé / vyžaduje rozhodnutí):"
echo "  • REBOOT pokud se UART zapnul poprvé (radar pak uvidí /dev/ttyAMA0)."
echo "  • Po cleanu obnov REÁLNÝ config (calendar ID, hesla) ze zálohy:"
echo "       ~/mirror-backup-*/MagicMirror-config/config.js → MagicMirror/config/config.js"
echo
echo "Ověření:"
echo "  curl -s http://127.0.0.1:8000/healthz; echo      # konzole"
echo "  systemctl status ld2450 mirror-console-backend mirror-console-web"
echo "  pm2 status MagicMirror"
