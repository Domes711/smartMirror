#!/usr/bin/env bash
# One-shot deploy: pull latest master, install deps, rebuild the frontend,
# and restart everything so changes (frontend + core + backend) take effect.
#
# Safe to run repeatedly. Per-Pi state is gitignored (backend/var/ — the
# SQLite DB, the face dataset, module assets and drafts — plus node_modules,
# config/pages.js and frontend/dist) so it is never touched. The only tracked
# runtime file is MagicMirror/config/config.js: it is backed up first and the
# pull is done with --autostash.
#
# Usage:  ./deploy.sh           # backend + frontend + MagicMirror (default)
#         ./deploy.sh --full    # also re-run every setup.sh (deps + units)
set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
cd "$REPO"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

c() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }       # step
ok() { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }    # success
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }  # warning
unit_installed() { systemctl list-unit-files "$1.service" 2>/dev/null | grep -q "$1.service"; }

# --- node / npm / pm2 (nvm is not on PATH for non-interactive shells) --------
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
NPM="${NPM_BIN:-$(command -v npm || ls -t "$NVM_DIR"/versions/node/*/bin/npm 2>/dev/null | head -1)}"
PM2="${PM2_BIN:-$(command -v pm2 || ls -t "$NVM_DIR"/versions/node/*/bin/pm2 2>/dev/null | head -1)}"
PY="$(command -v python3 || echo /usr/bin/python3)"
[ -n "$NPM" ] || { echo "npm not found (check nvm / node)"; exit 1; }

# --- 1. pull latest master ---------------------------------------------------
c "Pulling latest master…"
cp -f MagicMirror/config/config.js "MagicMirror/config/config.js.bak.$(date +%s)" 2>/dev/null \
  && ok "config.js backed up" || warn "config.js not found (skipping backup)"
git fetch --prune origin
CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CUR_BRANCH" = "master" ] || { c "Switching from '$CUR_BRANCH' to master"; git checkout master; }
OLD_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
if git pull --rebase --autostash origin master; then
  ok "at $(git rev-parse --short HEAD)"
  # deploy.sh may have rewritten itself in the pull — re-exec the new version
  # once so every later step runs from the updated script (e.g. unit names).
  if [ "${DEPLOY_REEXEC:-0}" != "1" ] && [ "$OLD_HEAD" != "$(git rev-parse HEAD)" ]; then
    ok "deploy.sh updated — running the new version…"
    DEPLOY_REEXEC=1 exec bash "$0" "$@"
  fi
else
  echo
  echo "‼ git pull failed (likely a conflict in config.js)."
  echo "  Check: git status   — then resolve manually and run deploy.sh again."
  exit 1
fi

# --- 2. backend --------------------------------------------------------------
if [ "$FULL" = "1" ]; then
  c "Reinstalling backend (--full: deps + units + migrations)…"
  ./backend/setup.sh
  ok "backend done"
else
  # Not --full: no pip, no unit rewrite. Just apply any pending DB migration
  # before the units restart into a schema they do not have yet.
  c "Applying DB migrations…"
  ( cd backend && PYTHONPATH="$PWD" "$PY" -c \
      'from shared import db, paths; paths.ensure_var_dirs(); db.init()' )
  ok "schema up to date"
fi

# --- 3. MagicMirror core deps ------------------------------------------------
if [ "$FULL" = "1" ]; then
  c "Reinstalling MagicMirror core + modules (--full)…"
  ( cd MagicMirror && ./setup.sh )
else
  c "Installing MagicMirror core dependencies…"
  ( cd MagicMirror && "$NPM" install --no-audit --no-fund )
fi
ok "MagicMirror deps ready"

# --- 4. frontend (:8090) -----------------------------------------------------
if unit_installed mirror-control; then
  c "Building frontend (:8090)…"
  ( cd frontend && "$NPM" install --no-audit --no-fund && "$NPM" run build )
  ok "frontend/dist generated"
else
  c "mirror-control.service missing — running frontend/setup.sh (build + unit)…"
  ( cd frontend && ./setup.sh )
  ok "mirror-control.service installed"
fi

# --- 5. restart everything ---------------------------------------------------
restart_unit() {  # restart a systemd unit only if it is installed
  if unit_installed "$1"; then
    sudo systemctl restart "$1" && ok "restart $1"
  else
    warn "$1.service not installed (skipping)"
  fi
}
c "Restarting services…"
# Features first, gateway last, so the edge comes back to a ready backend.
restart_unit radar
restart_unit display
restart_unit scenes
restart_unit modules
restart_unit mic
restart_unit camera-supervisor
restart_unit mirror-gateway
restart_unit mirror-control
# wyoming-satellite is deliberately NOT restarted here — it is arbitrated by
# features/mic/service.py (stopped/started around a test recording), not
# meant to bounce on every deploy.
if [ -n "$PM2" ]; then
  "$PM2" restart MagicMirror >/dev/null 2>&1 && ok "restart MagicMirror (pm2)" \
    || warn "pm2 restart MagicMirror failed (is MagicMirror running under pm2?)"
else
  warn "pm2 not found — MagicMirror not restarted"
fi

# --- 6. health check ---------------------------------------------------------
c "Checking…"
sleep 3
check() {  # check <label> <url> <hint>
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$2" || true)"
  [ "$code" = "200" ] && ok "$1 running (HTTP 200)" || warn "$1 not responding (HTTP $code) — see: $3"
}
check "gateway /healthz (:8000)" http://127.0.0.1:8000/healthz "journalctl -u camera-supervisor -n 50"
# scenes is MQTT-only (no port), so check the unit instead of an endpoint.
if systemctl is-active --quiet scenes; then
  ok "scenes running (unit active, MQTT-only)"
else
  warn "scenes not running — see: journalctl -u scenes -n 50"
fi
check "frontend         (:8090)" http://127.0.0.1:8090/        "journalctl -u mirror-control -n 50"
check "MagicMirror      (:8080)" http://127.0.0.1:8080/        "pm2 logs MagicMirror --lines 50"

echo
ok "Done. Frontend: http://<pi>:8090"
