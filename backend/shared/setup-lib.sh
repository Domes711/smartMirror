#!/bin/bash
# setup-lib.sh — sourced by every feature's setup.sh.
#
# Each feature is a self-contained unit (code + unit file + setup.sh), but the
# mechanics of "write a systemd unit that runs a python module out of
# backend/" are identical for all of them. This holds that one pattern so a
# feature setup.sh only declares *what* it runs, not *how*.

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"

# pip on Raspberry Pi OS Bookworm is externally-managed; we deliberately
# install into the system interpreter because the daemons need the system
# picamera2/RPi.GPIO packages, which a venv cannot see.
pip_install() {
  echo "▸ pip: $*"
  pip3 install --break-system-packages "$@" || {
    echo "⚠ pip install failed for: $*  (continuing)"; return 0; }
}

# install_unit <name> <description> <python -m target> [extra unit lines…]
install_unit() {
  local name="$1" desc="$2" target="$3"; shift 3
  local extra="$*"
  echo "▸ Installing ${name}.service…"
  sudo tee "/etc/systemd/system/${name}.service" >/dev/null <<EOF
[Unit]
Description=${desc}
Documentation=https://github.com/Domes711/smartMirror
After=network.target mosquitto.service
Wants=mosquitto.service

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${BACKEND_DIR}
Environment="PYTHONPATH=${BACKEND_DIR}"
Environment="PYTHONUNBUFFERED=1"
Environment="MQTT_BROKER=127.0.0.1"
Environment="MQTT_PORT=1883"
ExecStart=${PY} -m ${target}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
${extra}

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
}

enable_unit() {   # enable_unit <name> [--no-start]
  if [ "${2:-}" = "--no-start" ]; then
    sudo systemctl enable "$1" && echo "✓ $1 enabled (nestartuje se automaticky)"
  else
    sudo systemctl enable --now "$1" && echo "✓ $1 enabled + started"
  fi
}

install_sudoers() {
  local src="$BACKEND_DIR/shared/sudoers.d/smartmirror"
  [ -f "$src" ] || return 0
  echo "▸ Installing sudoers (features control each other's units)…"
  sudo cp "$src" /etc/sudoers.d/smartmirror
  sudo visudo -cf /etc/sudoers.d/smartmirror || true
}

# Run the DB migrations once, before any unit starts, so no daemon races to
# create the schema on first boot.
init_db() {
  echo "▸ SQLite schema…"
  (cd "$BACKEND_DIR" && PYTHONPATH="$BACKEND_DIR" "$PY" -c \
     'from shared import db, paths; paths.ensure_var_dirs(); db.init(); print("  db:", paths.DB_PATH)')
}
