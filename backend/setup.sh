#!/bin/bash
# setup.sh — master installer for the backend.
#
# Chains every feature's own setup.sh, then installs the edge gateway.
# Features are independent: a failure in one (e.g. a slow dlib build in
# camera) must NOT abort the rest.
set -u
. "$(cd "$(dirname "$0")/shared" && pwd)/setup-lib.sh"

FAILED=""
run() {  # run "Label" /path/to/setup.sh
  echo
  echo "── $1 ──"
  if bash "$2"; then echo "✓ $1"; else echo "✗ $1 — continuing (see error above)"; FAILED="$FAILED $1"; fi
}

echo "════════════════════════════════════════════"
echo "  Smart Mirror — backend setup ($BACKEND_DIR)"
echo "════════════════════════════════════════════"

install_sudoers
init_db

# Shared across every feature (shared/mqtt_client.py) — installed once here,
# not duplicated per feature. Features still migrating this get their own
# `pip_install paho-mqtt` removed as they are refactored (see display's).
pip_install paho-mqtt

# Migration order follows the design doc: radar/display first (already
# MQTT-only, lowest risk), then scenes/modules/ai_modules/mic, camera last
# (HW arbitration).
run "1/7  radar"      "$BACKEND_DIR/features/radar/setup.sh"
run "2/7  display"    "$BACKEND_DIR/features/display/setup.sh"
run "3/7  scenes"     "$BACKEND_DIR/features/scenes/setup.sh"
run "4/7  modules"    "$BACKEND_DIR/features/modules/setup.sh"
run "5/7  ai_modules" "$BACKEND_DIR/features/ai_modules/setup.sh"
run "6/7  mic"        "$BACKEND_DIR/features/mic/setup.sh"
run "7/7  camera"     "$BACKEND_DIR/features/camera/setup.sh"

echo
echo "── gateway (edge on :8000) ──"
install_unit mirror-gateway "Smart Mirror API Gateway" "gateway" \
  'Environment="GATEWAY_PORT=8000"'
enable_unit mirror-gateway

echo
echo "════════════════════════════════════════════"
if [ -n "$FAILED" ]; then
  echo "  ⚠ Done with errors in:$FAILED"
else
  echo "  ✓ Backend done."
fi
echo "════════════════════════════════════════════"
echo "Units: radar display scenes modules ai-modules mic camera-supervisor"
echo "       mirror-gateway (all enabled)"
echo "       camera-recognition (disabled — arbitrated by camera-supervisor)"
echo "       wyoming-satellite (disabled — arbitrated by features.mic.service)"
echo "       wyoming-openwakeword (enabled — holds no mic handle, stays up)"
echo "DB:    $BACKEND_DIR/var/smartmirror.db   (sqlite3 CLI for debugging)"
echo
echo "Verify:"
echo "  curl -s http://127.0.0.1:8000/healthz; echo"
echo "  curl -s http://127.0.0.1:8000/store/catalog | head -c 200; echo"
echo "  systemctl status radar display scenes modules mic camera-supervisor mirror-gateway"
