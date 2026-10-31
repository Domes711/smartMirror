#!/bin/bash
# setup.sh — distance feature (HC-SR04 ultrasonic sensor).
#
# Installs Python deps + the `distance` systemd unit, then enables + starts
# the daemon. No UART/raspi-config step needed — plain GPIO, already enabled
# by default on Raspberry Pi OS.
set -e
. "$(cd "$(dirname "$0")/../../shared" && pwd)/setup-lib.sh"

echo "── distance ──"
pip_install RPi.GPIO paho-mqtt
init_db

install_unit distance "HC-SR04 Distance Sensor" "features.distance.daemon"
enable_unit distance
systemctl status --no-pager --lines=0 distance || true

echo
echo "✓ Distance sensor installed (unit: distance)."
