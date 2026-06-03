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

# sudoers so the console may start/stop ld2450 (+ face_reco) — idempotent
SUDOERS_SRC="$DIR/../mirror-console/sudoers.d/mirror-console"
if [ -f "$SUDOERS_SRC" ]; then
  echo "▸ Installing sudoers (console controls ld2450/face_reco)…"
  sudo cp "$SUDOERS_SRC" /etc/sudoers.d/mirror-console
  sudo visudo -cf /etc/sudoers.d/mirror-console || true
fi

# Enable UART (hardware serial ON, serial login console OFF) — best-effort.
if command -v raspi-config >/dev/null 2>&1; then
  echo "▸ Enabling UART (raspi-config nonint)…"
  sudo raspi-config nonint do_serial_hw 0 2>/dev/null || true     # hw serial = ON
  sudo raspi-config nonint do_serial_cons 1 2>/dev/null || true   # login console = OFF
fi

sudo systemctl daemon-reload
sudo systemctl enable --now ld2450

sleep 1
systemctl status --no-pager --lines=0 ld2450 || true

echo
echo "✓ Radar nainstalován + autostart po rebootu."
echo "  UART nastaven automaticky (raspi-config). Pokud daemon nečte /dev/ttyAMA0:"
echo "    • je potřeba REBOOT, aby se UART projevil;"
echo "    • na Pi 3/4/Zero 2 je navíc nutné uvolnit PL011 od Bluetooth —"
echo "      přidej do /boot/firmware/config.txt:  dtoverlay=disable-bt  (a reboot)."
echo "  Zapínat/vypínat radar lze z konzole (tab Radar)."
