#!/bin/bash
# setup.sh — mic feature (USB mic config + test recording + Wyoming satellite
# arbitration).
#
# Installs three units:
#   wyoming-openwakeword   local wake-word detection (rhasspy/wyoming-openwakeword)
#   wyoming-satellite      streams audio to Home Assistant's Assist pipeline
#                          (rhasspy/wyoming-satellite); DISABLED at boot —
#                          features.mic.service start/stops it to free the
#                          mic for a test recording.
#   mic                    this feature's own MQTT + HTTP API (:8005)
#
# wyoming-satellite is officially deprecated upstream (superseded by Linux
# Voice Assistant / ESPHome), but still maintained enough to run — see
# docs/features/mic.md for the decision record.
set -e
. "$(cd "$(dirname "$0")/../../shared" && pwd)/setup-lib.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "── mic ──"
echo "▸ System deps (alsa-utils, git, python3-venv)…"
sudo apt-get update
sudo apt-get install -y alsa-utils git python3-venv python3-pip libopenblas-dev

init_db
install_sudoers
chmod +x "$HERE/apply-satellite-unit.sh"

# mic_config seeds `device`/`satellite_name`/`wake_word` on first read
# (features/mic/config.py DEFAULTS), same pattern as radar — read them now so
# the generated units below match whatever got seeded or was already set.
# A later change to any of these three over MQTT re-runs the same
# apply-satellite-unit.sh (see features/mic/service.py), so this is the only
# place that substitutes the template by hand.
read -r DEVICE SATELLITE_NAME WAKE_WORD <<EOF
$(PYTHONPATH="$BACKEND_DIR" "$PY" -c '
from features.mic import config
cfg = config.load()
print(cfg["device"], cfg["satellite_name"].replace(" ", "_"), cfg["wake_word"])
')
EOF
SATELLITE_NAME="${SATELLITE_NAME//_/ }"
echo "  device=${DEVICE} satellite_name=\"${SATELLITE_NAME}\" wake_word=${WAKE_WORD}"

WAKE_WORD_DIR="$HOME/wyoming-openwakeword"
SATELLITE_DIR="$HOME/wyoming-satellite"

echo "▸ wyoming-openwakeword…"
if [ ! -d "$WAKE_WORD_DIR" ]; then
  git clone https://github.com/rhasspy/wyoming-openwakeword.git "$WAKE_WORD_DIR"
fi
(cd "$WAKE_WORD_DIR" && script/setup)

echo "▸ wyoming-satellite…"
if [ ! -d "$SATELLITE_DIR" ]; then
  git clone https://github.com/rhasspy/wyoming-satellite.git "$SATELLITE_DIR"
fi
(cd "$SATELLITE_DIR" && script/setup)

echo "▸ Installing wyoming-openwakeword.service…"
sed \
  -e "s|__USER__|${RUN_USER}|g" \
  -e "s|__GROUP__|${RUN_GROUP}|g" \
  -e "s|__WAKE_WORD_DIR__|${WAKE_WORD_DIR}|g" \
  -e "s|__WAKE_WORD__|${WAKE_WORD}|g" \
  "$HERE/wyoming-openwakeword.service" | sudo tee /etc/systemd/system/wyoming-openwakeword.service >/dev/null

echo "▸ Installing wyoming-satellite.service…"
# Same substitution apply-satellite-unit.sh does for a later MQTT config
# change — run once by hand here (as ourselves, not via sudo -n, since the
# sudoers rule installed above may not have been re-read by this shell yet).
sed \
  -e "s|__USER__|${RUN_USER}|g" \
  -e "s|__GROUP__|${RUN_GROUP}|g" \
  -e "s|__SATELLITE_DIR__|${SATELLITE_DIR}|g" \
  -e "s|__SATELLITE_NAME__|${SATELLITE_NAME}|g" \
  -e "s|__DEVICE__|${DEVICE}|g" \
  -e "s|__WAKE_WORD__|${WAKE_WORD}|g" \
  "$HERE/wyoming-satellite.service" | sudo tee /etc/systemd/system/wyoming-satellite.service >/dev/null

sudo systemctl daemon-reload
enable_unit wyoming-openwakeword
enable_unit wyoming-satellite
sudo systemctl disable wyoming-satellite 2>/dev/null || true
sudo systemctl stop wyoming-satellite 2>/dev/null || true
echo "✓ wyoming-satellite installed (DISABLED at boot — arbitrated by features.mic.service)"

echo "▸ Installing mic.service…"
sed \
  -e "s|__USER__|${RUN_USER}|g" \
  -e "s|__GROUP__|${RUN_GROUP}|g" \
  -e "s|__BACKEND_DIR__|${BACKEND_DIR}|g" \
  -e "s|__PYTHON__|${PY}|g" \
  "$HERE/mic.service" | sudo tee /etc/systemd/system/mic.service >/dev/null
sudo systemctl daemon-reload

enable_unit mic
systemctl status --no-pager --lines=0 mic || true

echo
echo "✓ Mic API on 127.0.0.1:8005 (unit: mic)."
echo "  Satellite listens on tcp://$(hostname -I | awk '{print $1}'):10700 — add it manually in HA (Settings → Devices → Wyoming Protocol)."
echo "  List ALSA devices: arecord -L"
