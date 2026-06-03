#!/bin/bash
# setup.sh — install the LD2450 radar daemon after a git clone.
#
# Installs Python deps and the ld2450 systemd unit, then enables + starts it.
# The radar runs by default; turn it on/off from the console (Radar tab).
#
# Usage (on the Pi):
#   cd ~/smartMirror/ld2450 && ./setup.sh
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
USER_NAME="$(id -un)"
GROUP_NAME="$(id -gn)"
cd "$DIR"

echo "▸ ld2450: $DIR"

echo "▸ Python deps (pyserial, paho-mqtt, RPi.GPIO)…"
pip3 install --break-system-packages pyserial paho-mqtt RPi.GPIO

echo "▸ Installing ld2450.service…"
sudo tee /etc/systemd/system/ld2450.service >/dev/null <<EOF
[Unit]
Description=LD2450 Radar Presence Detection Daemon
After=network.target mosquitto.service
Wants=mosquitto.service

[Service]
Type=simple
User=$USER_NAME
Group=$GROUP_NAME
WorkingDirectory=$DIR
ExecStart=$PY $DIR/ld2450_daemon.py
Restart=always
RestartSec=10
Environment="MQTT_BROKER=127.0.0.1"
Environment="MQTT_PORT=1883"
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ld2450

sleep 1
systemctl status --no-pager --lines=0 ld2450 || true

echo
echo "✓ Radar běží + autostart po rebootu."
echo "  Předpoklad: UART musí být povolený — raspi-config → Interface → Serial Port:"
echo "    'login shell over serial' = NO,  'serial port hardware' = YES"
echo "    (daemon čte /dev/ttyAMA0 @ 256000 baud)."
echo "  Zapínat/vypínat lze z konzole (tab Radar); ovládání vyžaduje sudoers:"
echo "    sudo cp ../mirror-console/sudoers.d/mirror-console /etc/sudoers.d/"
