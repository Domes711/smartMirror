#!/bin/bash
# setup.sh — scenes feature (layout/scene store + pages.js/modules.js codegen).
# MQTT-only: no HTTP server, no port.
set -e
. "$(cd "$(dirname "$0")/../../shared" && pwd)/setup-lib.sh"

echo "── scenes ──"
pip_install paho-mqtt
init_db

install_unit scenes "Smart Mirror Scenes" "features.scenes.service"
enable_unit scenes
systemctl status --no-pager --lines=0 scenes || true

echo
echo "✓ Scenes installed (unit: scenes, MQTT-only — no port)."
