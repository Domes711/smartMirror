#!/bin/bash
# setup.sh — install the face-recognition camera daemon after a git clone.
#
# Installs system + Python deps and the face_reco systemd unit. The unit is
# left DISABLED on purpose: the camera is an exclusive resource arbitrated by
# mirror-console, which starts/stops face_reco itself (mode "Face detect").
#
# Usage (on the Pi):
#   cd ~/smartMirror/camera && ./setup.sh
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
USER_NAME="$(id -un)"
GROUP_NAME="$(id -gn)"
cd "$DIR"

echo "▸ camera: $DIR"

echo "▸ System deps (picamera2, mosquitto)…"
sudo apt-get update
sudo apt-get install -y python3-picamera2 mosquitto mosquitto-clients
sudo systemctl enable --now mosquitto

echo "▸ Python deps (face_recognition, mediapipe, opencv… — may take a while)…"
pip3 install --break-system-packages -r requirements.txt

echo "▸ Installing face_reco.service (managed by mirror-console; not autostarted)…"
sudo tee /etc/systemd/system/face_reco.service >/dev/null <<EOF
[Unit]
Description=Face Recognition Daemon for MMM-Profile
After=network.target mosquitto.service
Wants=mosquitto.service

[Service]
Type=simple
User=$USER_NAME
Group=$GROUP_NAME
WorkingDirectory=$DIR
ExecStart=$PY $DIR/face_reco_daemon.py
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
sudo systemctl disable face_reco 2>/dev/null || true

echo
echo "✓ Camera ready."
echo "  face_reco je nainstalovaný, ale VYPNUTÝ z autostartu — řídí ho"
echo "  mirror-console (režim Face detect). Aby ho konzole směla ovládat,"
echo "  nainstaluj sudoers: sudo cp ../mirror-console/sudoers.d/mirror-console /etc/sudoers.d/"
echo "  Trénink obličejů: přes konzoli (Profily → Přidat profil)."
