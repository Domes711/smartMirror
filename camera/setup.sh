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

# WebSocket listener so the mirrorControl app (browser) can speak MQTT directly.
# TCP 1883 stays for the Pi-side daemons; 9001 is websockets for the phone app.
echo "▸ mosquitto: TCP 1883 + WebSocket 9001 (for mirrorControl)…"
sudo tee /etc/mosquitto/conf.d/smartmirror.conf >/dev/null <<'EOF'
listener 1883
protocol mqtt

listener 9001
protocol websockets

allow_anonymous true
EOF
sudo systemctl restart mosquitto

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

# sudoers so the console may start/stop face_reco (+ ld2450) — idempotent
SUDOERS_SRC="$DIR/../mirror-console/sudoers.d/mirror-console"
if [ -f "$SUDOERS_SRC" ]; then
  echo "▸ Installing sudoers (console controls face_reco/ld2450)…"
  sudo cp "$SUDOERS_SRC" /etc/sudoers.d/mirror-console
  sudo visudo -cf /etc/sudoers.d/mirror-console || true
fi

echo
echo "✓ Camera ready."
echo "  face_reco je nainstalovaný, ale VYPNUTÝ z autostartu — řídí ho"
echo "  mirror-console (režim Face detect). Trénink obličejů: přes konzoli"
echo "  (Profily → Přidat profil)."
