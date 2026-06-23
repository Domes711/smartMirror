#!/usr/bin/env bash
# deploy-fe.sh — FRONT-END ONLY deploy: pull latest master, rebuild the Mirror
# Control app (mirrorControl/) and restart just its server. Nothing else (no
# MagicMirror, console, radar or camera) is touched — use deploy.sh for those.
#
# Usage:  ./deploy-fe.sh
set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
cd "$REPO"
PORT="${MIRROR_CONTROL_PORT:-8090}"

c() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }

# --- node / npm (nvm is not on PATH for non-interactive shells) ---------------
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
NPM="${NPM_BIN:-$(command -v npm || ls -t "$NVM_DIR"/versions/node/*/bin/npm 2>/dev/null | head -1)}"
[ -n "$NPM" ] || { echo "✗ npm nenalezeno (zkontroluj nvm / node)"; exit 1; }

# --- 1. pull latest master ----------------------------------------------------
c "Stahuji nejnovější master…"
git fetch --prune origin
CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CUR_BRANCH" = "master" ] || { c "Přepínám z '$CUR_BRANCH' na master"; git checkout master; }
OLD_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
if git pull --rebase --autostash origin master; then
  ok "na $(git rev-parse --short HEAD)"
  # this script may have changed in the pull — re-exec the new version once
  if [ "${DEPLOY_FE_REEXEC:-0}" != "1" ] && [ "$OLD_HEAD" != "$(git rev-parse HEAD)" ]; then
    ok "deploy-fe.sh aktualizován — spouštím novou verzi…"
    DEPLOY_FE_REEXEC=1 exec bash "$0" "$@"
  fi
else
  echo "‼ git pull selhal — vyřeš ručně (git status) a spusť znovu."; exit 1
fi

# --- 2. build the app ---------------------------------------------------------
c "Buildím Mirror Control…"
( cd mirrorControl && "$NPM" install --no-audit --no-fund && "$NPM" run build )
ok "mirrorControl/dist vygenerován"

# --- 3. restart its server (install the unit first run via setup.sh) ----------
if systemctl list-unit-files mirror-control.service 2>/dev/null | grep -q mirror-control.service; then
  c "Restartuji mirror-control…"
  sudo systemctl restart mirror-control && ok "restart mirror-control"
else
  warn "mirror-control.service není nainstalován — spouštím mirrorControl/setup.sh"
  ( cd mirrorControl && ./setup.sh )
fi

# --- 4. health check ----------------------------------------------------------
sleep 2
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
[ "$code" = "200" ] && ok "Mirror Control běží (HTTP 200, :$PORT)" \
  || warn "Mirror Control neodpovídá (HTTP $code) — viz: journalctl -u mirror-control -n 30"

echo
ok "Hotovo. Mirror Control: http://<pi>:$PORT"
