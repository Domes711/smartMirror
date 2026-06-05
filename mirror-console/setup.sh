#!/bin/bash
# setup.sh — bring up the mirror-console (supervisor + web) correctly.
#
# Builds the React web, installs deps, then generates + enables two systemd
# units with paths/binaries detected at setup time (robust to repo location and
# nvm node version changes — just re-run this after a node upgrade).
#
# Usage (on the Pi):
#   cd ~/smartMirror/mirror-console && ./setup.sh
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"          # .../mirror-console
NODE="$(command -v node || echo /usr/bin/node)"
PY="$(command -v python3 || echo /usr/bin/python3)"
USER_NAME="$(id -un)"
GROUP_NAME="$(id -gn)"

echo "▸ repo:   $DIR"
echo "▸ node:   $NODE"
echo "▸ python: $PY"
echo "▸ user:   $USER_NAME"

echo "▸ Installing deps + building web…"
( cd "$DIR/server" && npm install --no-audit --no-fund )
( cd "$DIR/web" && npm install --no-audit --no-fund && npm run build )

echo "▸ Writing systemd units…"
sudo tee /etc/systemd/system/mirror-console-backend.service >/dev/null <<EOF
[Unit]
Description=Smart Mirror camera console — supervisor (camera arbiter)
After=network.target mosquitto.service

[Service]
Type=simple
User=$USER_NAME
Group=$GROUP_NAME
WorkingDirectory=$DIR/backend
ExecStart=$PY $DIR/backend/supervisor.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/mirror-console-web.service >/dev/null <<EOF
[Unit]
Description=Smart Mirror camera console — web front-end (Express + React)
After=network.target mirror-console-backend.service
Wants=mirror-console-backend.service

[Service]
Type=simple
User=$USER_NAME
Group=$GROUP_NAME
WorkingDirectory=$DIR/server
ExecStart=$NODE $DIR/server/index.js
Environment=PORT=8000
# AI module builder needs ANTHROPIC_API_KEY — put it (and any overrides such as
# MODULE_AI_MODEL) in server/.env; the leading "-" makes the file optional.
EnvironmentFile=-$DIR/server/.env
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "▸ Enabling + (re)starting services…"
# stop any manual instances so they don't fight over ports/camera
pkill -f "backend/supervisor.py" 2>/dev/null || true
pkill -f "server/index.js" 2>/dev/null || true

sudo systemctl daemon-reload
sudo systemctl enable mirror-console-backend mirror-console-web
sudo systemctl restart mirror-console-backend mirror-console-web

sleep 1
systemctl status --no-pager --lines=0 mirror-console-backend mirror-console-web || true
echo
echo "✓ Mirror console je v provozu (autostart po rebootu zapnut)."
echo "  Test:    curl -s http://127.0.0.1:8000/healthz; echo"
echo "  Logy:    journalctl -u mirror-console-web -f"
echo
echo "Pozn.: jednorázové předpoklady mimo tento skript —"
echo "  • AI tvorba modulů:  echo 'ANTHROPIC_API_KEY=sk-ant-…' > server/.env  (volitelně MODULE_AI_MODEL=…)"
echo "  • sudoers pro face_reco/ld2450:  sudo cp sudoers.d/mirror-console /etc/sudoers.d/"
echo "  • MagicMirror cesta (volitelně):  Environment=MAGICMIRROR_DIR=… v backend unitě"
