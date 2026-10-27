#!/bin/bash
# setup.sh — camera feature (face recognition + supervisor/enrollment).
#
# Installs two units:
#   camera-recognition   the production face-reco daemon. Installed but left
#                        DISABLED: the camera is exclusive and the supervisor
#                        starts/stops it (mode "Face detect").
#   camera-supervisor    the arbiter + MJPEG stream + enrollment API (:8001).
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
sudo tee /etc/mosquitto/conf.d/smartmirror.conf >/dev/null <<'MOSQ'
listener 1883
protocol mqtt

listener 9001
protocol websockets

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

install_unit camera-recognition "Face Recognition Daemon" "features.camera.recognition_daemon"
sudo systemctl disable camera-recognition 2>/dev/null || true
echo "✓ camera-recognition installed (DISABLED at boot — arbitrated by the supervisor)"

install_unit camera-supervisor "Camera Supervisor (arbiter + stream + enrollment)" \
  "features.camera.daemon"
enable_unit camera-supervisor
systemctl status --no-pager --lines=0 camera-supervisor || true

echo
echo "✓ Camera ready. Train faces in the app (Profiles → Add profile)."
