#!/bin/bash
# setup.sh — camera feature (face/gesture recognition + enrollment, one
# process — camera-supervisor — holds the camera for its entire life and
# runs the idle/face/gesture presence state machine itself; there is no
# second recognition process to arbitrate with any more).
set -e
. "$(cd "$(dirname "$0")/../../shared" && pwd)/setup-lib.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "── camera ──"
echo "▸ System deps (picamera2, mosquitto)…"
sudo apt-get update
sudo apt-get install -y python3-picamera2 mosquitto mosquitto-clients
sudo systemctl enable --now mosquitto

# WebSocket listener so the frontend app (browser) can speak MQTT directly.
# TCP 1883 stays for the Pi-side daemons; 9001 is websockets for the app.
#
# If the shared TLS cert (backend/var/tls/, see the root setup.sh) exists,
# 9001 speaks TLS (wss://) instead of plain ws:// — a https:// frontend page
# cannot open a plain ws:// socket (mixed content), so once the frontend is
# HTTPS, the broker's WebSocket listener must be too, with the SAME cert so
# the browser only ever has one self-signed warning to accept.
echo "▸ mosquitto: TCP 1883 + WebSocket 9001…"
# Neutralize any OTHER conf.d file declaring a listener — a leftover (e.g.
# local.conf with `listener 1883`) collides with ours and mosquitto refuses
# to start with "Duplicate listener".
for f in /etc/mosquitto/conf.d/*.conf; do
  [ -e "$f" ] || continue
  case "$f" in */smartmirror.conf) continue ;; esac
  if grep -qE '^[[:space:]]*listener' "$f" 2>/dev/null; then
    sudo mv "$f" "$f.disabled.$(date +%s)"
    echo "  • disabled conflicting $(basename "$f") (had a listener)"
  fi
done

TLS_DIR="$(cd "$HERE/../.." && pwd)/var/tls"
WS_TLS_CONF=""
if [ -f "$TLS_DIR/key.pem" ] && [ -f "$TLS_DIR/cert.pem" ]; then
  # mosquitto runs as its own system user — it can't read files owned by
  # whoever ran setup.sh unless group/world-readable. A self-signed cert for
  # a LAN-only mirror is low-stakes enough that world-readable is fine here.
  sudo chmod 644 "$TLS_DIR/key.pem" "$TLS_DIR/cert.pem" 2>/dev/null || true
  WS_TLS_CONF="
cafile $TLS_DIR/cert.pem
certfile $TLS_DIR/cert.pem
keyfile $TLS_DIR/key.pem"
  echo "  • wss:// (TLS cert found at $TLS_DIR)"
else
  echo "  • ws:// (no shared TLS cert yet — plain WebSocket)"
fi

sudo tee /etc/mosquitto/conf.d/smartmirror.conf >/dev/null <<MOSQ
listener 1883
protocol mqtt

listener 9001
protocol websockets$WS_TLS_CONF

allow_anonymous true
MOSQ
sudo systemctl restart mosquitto \
  || echo "  ! mosquitto restart failed — see: sudo journalctl -u mosquitto -n 20 -l"

echo "▸ Python deps (face_recognition, mediapipe, opencv… — may take a while)…"
pip_install -r "$HERE/requirements.txt"
# TurboJPEG makes the MJPEG stream 3-5× cheaper on the Pi. <2.0 is the last
# release that works with the system libturbojpeg on Bookworm.
pip_install "PyTurboJPEG<2.0"

init_db
install_sudoers

# One-shot migration: the enrolled faces used to live in the repo at
# camera/dataset/ and camera/encoded_faces.pickle. They are per-Pi data, so
# they move under backend/var/ (gitignored) and get indexed into SQLite.
LEGACY_DATASET="$REPO_ROOT/camera/dataset"
if [ -d "$LEGACY_DATASET" ] && [ ! -e "$BACKEND_DIR/var/dataset/.migrated" ]; then
  echo "▸ Migrating face dataset → backend/var/dataset/…"
  mkdir -p "$BACKEND_DIR/var/dataset"
  cp -rn "$LEGACY_DATASET/." "$BACKEND_DIR/var/dataset/" 2>/dev/null || true
  touch "$BACKEND_DIR/var/dataset/.migrated"
fi
LEGACY_PICKLE="$REPO_ROOT/camera/encoded_faces.pickle"
if [ -f "$LEGACY_PICKLE" ] && [ ! -f "$BACKEND_DIR/var/encoded_faces.pickle" ]; then
  cp "$LEGACY_PICKLE" "$BACKEND_DIR/var/encoded_faces.pickle"
fi
# Index whatever is on disk into camera_photos / profiles.
PYTHONPATH="$BACKEND_DIR" "$PY" -c \
  'from features.camera import profiles; print("  profiles:", [p["name"] for p in profiles.list_all()])' || true

install_unit camera-supervisor "Camera Supervisor (recognition + stream + enrollment)" \
  "features.camera.daemon"
enable_unit camera-supervisor
systemctl status --no-pager --lines=0 camera-supervisor || true

echo
echo "✓ Camera ready. Train faces in the app (Profiles → Add profile)."
