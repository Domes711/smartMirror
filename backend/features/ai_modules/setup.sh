#!/bin/bash
# setup.sh — ai_modules feature (AI module builder).
#
# The systemd unit is installed from ai-modules.service, a template with
# placeholders (__USER__, __GROUP__, __BACKEND_DIR__, __PYTHON__) substituted
# below — not generated from scratch like shared/setup-lib.sh's install_unit.
set -e
. "$(cd "$(dirname "$0")/../../shared" && pwd)/setup-lib.sh"

echo "── ai_modules ──"

FEATURE_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "▸ Installing ai-modules.service…"
sed \
  -e "s|__USER__|${RUN_USER}|g" \
  -e "s|__GROUP__|${RUN_GROUP}|g" \
  -e "s|__BACKEND_DIR__|${BACKEND_DIR}|g" \
  -e "s|__PYTHON__|${PY}|g" \
  "$FEATURE_DIR/ai-modules.service" | sudo tee /etc/systemd/system/ai-modules.service >/dev/null
sudo systemctl daemon-reload

enable_unit ai-modules
systemctl status --no-pager --lines=0 ai-modules || true

echo
echo "✓ AI module builder installed (unit: ai-modules, :8004)."
echo "  Needs the Claude CLI logged in on the Pi: claude login"
