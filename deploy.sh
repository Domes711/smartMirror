#!/usr/bin/env bash
# One-shot deploy: pull latest master, install deps, rebuild the web console,
# and restart everything so changes (front-end + back-end + modules) take effect.
#
# Safe to run repeatedly. Per-Pi state is gitignored (layout_store.json,
# installed_modules.json, console-modules.js, pages.js, radar_config.json,
# server/.env, node_modules, web/dist) so it is never touched. The only tracked
# runtime file is MagicMirror/config/config.js — it is backed up first and the
# pull is done with --autostash so your local (console-injected) version is kept.
#
# Usage:  ./deploy.sh           # console + MagicMirror restart (fast, default)
#         ./deploy.sh --full    # also reinstall MagicMirror core + module deps
set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
cd "$REPO"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

c() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }       # step
ok() { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }    # success
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }  # warning

# --- node / npm / pm2 (nvm is not on PATH for non-interactive shells) ---------
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
NPM="${NPM_BIN:-$(command -v npm || ls -t "$NVM_DIR"/versions/node/*/bin/npm 2>/dev/null | head -1)}"
PM2="${PM2_BIN:-$(command -v pm2 || ls -t "$NVM_DIR"/versions/node/*/bin/pm2 2>/dev/null | head -1)}"
[ -n "$NPM" ] || { echo "npm nenalezeno (zkontroluj nvm / node)"; exit 1; }

# --- 1. pull latest master ----------------------------------------------------
c "Stahuji nejnovější master…"
cp -f MagicMirror/config/config.js "MagicMirror/config/config.js.bak.$(date +%s)" 2>/dev/null \
  && ok "config.js zálohován" || warn "config.js nenalezen (přeskakuji zálohu)"
git fetch --prune origin
CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CUR_BRANCH" = "master" ] || { c "Přepínám z '$CUR_BRANCH' na master"; git checkout master; }
if git pull --rebase --autostash origin master; then
  ok "na $(git rev-parse --short HEAD)"
else
  echo
  echo "‼ git pull selhal (nejspíš konflikt v config.js)."
  echo "  Zkontroluj: git status   — pak vyřeš ručně a spusť deploy.sh znovu."
  exit 1
fi

# --- 2. console back-end deps -------------------------------------------------
c "Instaluji závislosti konzole (server)…"
( cd mirror-console/server && "$NPM" install --no-audit --no-fund )
ok "server hotov"

# --- 3. console web: deps + build --------------------------------------------
c "Buildím web konzoli…"
( cd mirror-console/web && "$NPM" install --no-audit --no-fund && "$NPM" run build )
ok "web/dist vygenerován"

# --- 4. (optional) MagicMirror core + module deps ----------------------------
if [ "$FULL" = "1" ]; then
  c "Reinstaluji MagicMirror core + moduly (--full)…"
  ( cd MagicMirror && ./setup.sh )
  ok "MagicMirror deps hotové"
fi

# --- 5. restart everything ----------------------------------------------------
restart_unit() {  # restart a systemd unit only if it is installed
  if systemctl list-unit-files "$1.service" 2>/dev/null | grep -q "$1.service"; then
    sudo systemctl restart "$1" && ok "restart $1"
  else
    warn "$1.service není nainstalován (přeskakuji)"
  fi
}
c "Restartuji služby…"
restart_unit mirror-console-backend
restart_unit mirror-console-web
restart_unit ld2450
if [ -n "$PM2" ]; then
  "$PM2" restart MagicMirror >/dev/null 2>&1 && ok "restart MagicMirror (pm2)" \
    || warn "pm2 restart MagicMirror selhal (běží MagicMirror pod pm2?)"
else
  warn "pm2 nenalezeno — MagicMirror nerestartováno"
fi

# --- 6. health check ----------------------------------------------------------
c "Kontrola…"
sleep 2
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/healthz || true)"
[ "$code" = "200" ] && ok "konzole běží (HTTP 200)" || warn "konzole neodpovídá (HTTP $code) — viz: journalctl -u mirror-console-web -n 50"

echo
ok "Hotovo. Změny FE i BE jsou nasazené."
