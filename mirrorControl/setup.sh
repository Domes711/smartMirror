#!/bin/bash
# setup.sh — build the Mirror Control app and install its systemd unit.
#
# The app is a Vite SPA served by `vite preview` on :8090 (MagicMirror owns
# :8080, the console owns :8000). It talks to the mirror over MQTT (ws :9001)
# and proxies REST to the console (:8000) — see vite.config.ts.
#
# Usage (on the Pi):
#   cd ~/smartMirror/mirrorControl && ./setup.sh
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"          # .../mirrorControl
# nvm is not on PATH for non-interactive shells — source it if present
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
NPM="${NPM_BIN:-$(command -v npm || ls -t "$NVM_DIR"/versions/node/*/bin/npm 2>/dev/null | head -1)}"
[ -n "$NPM" ] || { echo "✗ npm nenalezeno (zkontroluj nvm / node)"; exit 1; }
NODE_BIN_DIR="$(dirname "$NPM")"
USER_NAME="$(id -un)"
PORT="${MIRROR_CONTROL_PORT:-8090}"

echo "▸ repo: $DIR"
echo "▸ npm:  $NPM"
echo "▸ user: $USER_NAME  port: $PORT"

echo "▸ Installing deps + building…"
( cd "$DIR" && "$NPM" install --no-audit --no-fund && "$NPM" run build )

echo "▸ Writing systemd unit (mirror-control, :$PORT)…"
sudo tee /etc/systemd/system/mirror-control.service >/dev/null <<EOF
[Unit]
Description=Mirror Control web app (Vite preview)
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$DIR
Environment=HOME=$HOME
Environment=PATH=$NODE_BIN_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=$NPM run preview -- --host 0.0.0.0 --port $PORT --strictPort
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mirror-control >/dev/null 2>&1 || sudo systemctl restart mirror-control
echo "✓ mirror-control běží na http://<pi>:$PORT"
