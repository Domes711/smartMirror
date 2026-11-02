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

# One TLS cert for both HTTPS surfaces that need a secure context: the
# frontend app (getUserMedia — new-profile wizard, AddPhotos) and mosquitto's
# WebSocket listener (a https:// page cannot open a plain ws:// socket —
# mixed content — so :9001 needs wss:// once the frontend is HTTPS). Shared
# here rather than generated independently by each setup.sh so there is only
# ONE self-signed cert to accept in the browser, and no ordering dependency
# between backend/setup.sh (mosquitto, runs first) and frontend/setup.sh.
TLS_DIR="$DIR/backend/var/tls"
if [ ! -f "$TLS_DIR/key.pem" ] || [ ! -f "$TLS_DIR/cert.pem" ]; then
  if command -v openssl >/dev/null 2>&1; then
    echo "▸ Generating shared self-signed TLS cert ($TLS_DIR)…"
    mkdir -p "$TLS_DIR"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/cert.pem" \
      -subj "/CN=smartmirror" >/dev/null 2>&1 \
      && echo "✓ cert written to $TLS_DIR" \
      || echo "! cert generation failed — frontend + MQTT WebSocket stay plain http/ws (no device camera)"
  else
    echo "! openssl not found — frontend + MQTT WebSocket stay plain http/ws (no device camera)"
  fi
fi

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
TLS_DIR="$DIR/backend/var/tls"
if [ -f "$TLS_DIR/key.pem" ] && [ -f "$TLS_DIR/cert.pem" ]; then
  echo "  • Self-signed TLS cert is in use (frontend https:// + MQTT wss://)."
  echo "    The browser treats :8090 and :9001 as separate trust decisions —"
  echo "    open https://<pi>:8090 once and accept the warning for BOTH"
  echo "    (it may prompt a second time for the WebSocket on first connect)."
  echo
fi
echo "Manual (sensitive / needs a decision):"
echo "  • REBOOT if UART was just enabled (radar then sees /dev/ttyAMA0)."
echo "  • Import the community module store ONCE (MMM-store → SQLite):"
echo "       ./import-store.sh"
echo "  • Restore the REAL config (calendar ID, passwords) from your own backup, if any:"
echo "       MagicMirror/config/config.js"
echo
FRONTEND_SCHEME="http"
[ -f "$TLS_DIR/key.pem" ] && [ -f "$TLS_DIR/cert.pem" ] && FRONTEND_SCHEME="https"
echo "Verify:"
echo "  curl -s http://127.0.0.1:8000/healthz; echo        # camera via gateway"
echo "  curl -s http://127.0.0.1:8000/store/catalog | head -c 120; echo   # modules"
echo "  curl -sk -o /dev/null -w '%{http_code}\\n' $FRONTEND_SCHEME://127.0.0.1:8090/   # frontend"
echo "  systemctl status radar display scenes modules mic camera-supervisor mirror-gateway mirror-control"
echo "  pm2 status MagicMirror"
echo "  sqlite3 backend/var/smartmirror.db .tables              # DB state"
echo
echo "Frontend app:  $FRONTEND_SCHEME://<pi>:8090"
