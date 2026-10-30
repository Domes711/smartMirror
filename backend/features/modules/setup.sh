#!/bin/bash
# setup.sh — modules feature (the module store).
#
# The AI module builder is a separate feature now — see
# features/ai_modules/setup.sh.
#
# The systemd unit is installed from modules.service, a template with
# placeholders (__USER__, __GROUP__, __BACKEND_DIR__, __PYTHON__) substituted
# below — not generated from scratch like shared/setup-lib.sh's install_unit.
set -e
. "$(cd "$(dirname "$0")/../../shared" && pwd)/setup-lib.sh"

echo "── modules ──"
init_db

# No seed call here — features.modules.daemon's main() already calls
# catalog.seed_builtins() on every boot (idempotent, no network).

# The community catalog comes from the MMM-store repo (clone/pull into
# var/mmm-store + import into module_catalog/module_fields). Network-bound,
# so a failure only warns — re-run by hand with
#   python3 -m features.modules.store_import
echo "▸ Importing the module store (MMM-store)…"
(cd "$BACKEND_DIR" && "$PY" -m features.modules.store_import) \
  || echo "⚠ Module store import failed — run it again later: cd $BACKEND_DIR && $PY -m features.modules.store_import"

FEATURE_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "▸ Installing modules.service…"
sed \
  -e "s|__USER__|${RUN_USER}|g" \
  -e "s|__GROUP__|${RUN_GROUP}|g" \
  -e "s|__BACKEND_DIR__|${BACKEND_DIR}|g" \
  -e "s|__PYTHON__|${PY}|g" \
  "$FEATURE_DIR/modules.service" | sudo tee /etc/systemd/system/modules.service >/dev/null
sudo systemctl daemon-reload

enable_unit modules
systemctl status --no-pager --lines=0 modules || true

echo
echo "✓ Modules API na 127.0.0.1:8003 (unit: modules)."
