#!/bin/bash
# setup.sh — master installer for the whole smart mirror.
#
# Fresh Pi flow:
#   git clone <repo> smartMirror
#   cd smartMirror && ./setup.sh
#
# Runs the backend master setup (which chains every feature's own setup.sh),
# then MagicMirror and the frontend app.
#
# NOTE: components are independent — a failure in one (e.g. a slow dlib/mediapipe
# build in camera) must NOT abort the rest, so MagicMirror still comes up.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"

# Self-bootstrap: if this file was dropped OUTSIDE the repo (the component dirs
# aren't next to it), clone/update the repo into ~/smartMirror and hand off to
# its setup.sh. Lets you copy JUST this one file to a fresh Pi and run it.
# Override: SMARTMIRROR_REPO=…  SMARTMIRROR_BRANCH=…  SMARTMIRROR_DIR=…
if [ ! -f "$DIR/backend/setup.sh" ] || [ ! -f "$DIR/MagicMirror/setup.sh" ]; then
  TARGET="${SMARTMIRROR_DIR:-$HOME/smartMirror}"
  if [ "$DIR" = "$TARGET" ]; then
    echo "✗ Repo at $TARGET is incomplete (missing a component's setup.sh)."
    echo "  Delete it (nuke-pi.sh) and run setup.sh again outside the repo."
    exit 1
  fi
  REPO_URL="${SMARTMIRROR_REPO:-git@github.com:Domes711/smartMirror.git}"
  BRANCH="${SMARTMIRROR_BRANCH:-master}"
  if ! command -v git >/dev/null 2>&1; then
    echo "✗ git is not installed (sudo apt-get install -y git)"; exit 1
  fi
  echo "▸ setup.sh running outside the repo ($DIR) — bootstrapping → $TARGET"
  if [ -d "$TARGET/.git" ]; then
    git -C "$TARGET" fetch origin "$BRANCH" 2>/dev/null && git -C "$TARGET" checkout "$BRANCH" 2>/dev/null
    git -C "$TARGET" pull --ff-only origin "$BRANCH" || echo "⚠ pull failed — continuing with the existing checkout"
  else
    echo "▸ Cloning $REPO_URL ($BRANCH) → $TARGET"
    git clone --branch "$BRANCH" "$REPO_URL" "$TARGET" \
      || { echo "✗ git clone failed — check your SSH key, or: SMARTMIRROR_REPO=https://github.com/Domes711/smartMirror.git bash setup.sh"; exit 1; }
  fi
  exec bash "$TARGET/setup.sh"
fi

cd "$DIR"

FAILED=""
run() {  # run "Label" /path/to/setup.sh
  echo
  echo "── $1 ──"
  if bash "$2"; then echo "✓ $1"; else echo "✗ $1 — continuing (see error above)"; FAILED="$FAILED $1"; fi
}

echo "════════════════════════════════════════════"
echo "  Smart Mirror — master setup ($DIR)"
echo "════════════════════════════════════════════"

run "1/3  Backend (all features)"     "$DIR/backend/setup.sh"
run "2/3  MagicMirror (+ pm2)"        "$DIR/MagicMirror/setup.sh"
run "3/3  Frontend app"               "$DIR/frontend/setup.sh"

echo
echo "════════════════════════════════════════════"
if [ -n "$FAILED" ]; then
  echo "  ⚠ Done with errors in:$FAILED"
  echo "    (the other parts are running; fix the failing one and run its setup.sh separately)"
else
  echo "  ✓ Done."
fi
echo "════════════════════════════════════════════"
echo "Automated: sudoers, SQLite schema + catalog seed, UART (raspi-config), pm2 autostart."
echo
echo "Manual (sensitive / needs a decision):"
echo "  • REBOOT if UART was just enabled (radar then sees /dev/ttyAMA0)."
echo "  • Restore the REAL config (calendar ID, passwords) from your own backup, if any:"
echo "       MagicMirror/config/config.js"
echo
echo "Verify:"
echo "  curl -s http://127.0.0.1:8000/healthz; echo        # camera via gateway"
echo "  curl -s http://127.0.0.1:8000/store/catalog | head -c 120; echo   # modules"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8090/   # frontend"
echo "  systemctl status radar display scenes modules mic camera-supervisor mirror-gateway mirror-control"
echo "  pm2 status MagicMirror"
echo "  sqlite3 backend/var/smartmirror.db .tables              # DB state"
echo
echo "Frontend app:  http://<pi>:8090"
