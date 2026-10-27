#!/bin/bash
# setup.sh — display feature (Dell U2515H over DDC/CI).
#
# The systemd unit is installed from display.service, a template with
# placeholders (__USER__, __GROUP__, __BACKEND_DIR__, __PYTHON__) substituted
# below — not generated from scratch like shared/setup-lib.sh's install_unit.
set -e
. "$(cd "$(dirname "$0")/../../shared" && pwd)/setup-lib.sh"

echo "── display ──"

if ! command -v ddcutil >/dev/null 2>&1; then
  echo "▸ ddcutil missing — installing…"
  sudo apt-get install -y ddcutil || echo "⚠ ddcutil not installed — display install failed"
fi

FEATURE_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "▸ Installing display.service…"
sed \
  -e "s|__USER__|${RUN_USER}|g" \
  -e "s|__GROUP__|${RUN_GROUP}|g" \
  -e "s|__BACKEND_DIR__|${BACKEND_DIR}|g" \
  -e "s|__PYTHON__|${PY}|g" \
  "$FEATURE_DIR/display.service" | sudo tee /etc/systemd/system/display.service >/dev/null
sudo systemctl daemon-reload

enable_unit display
systemctl status --no-pager --lines=0 display || true

echo
echo "✓ Display control installed (unit: display)."
