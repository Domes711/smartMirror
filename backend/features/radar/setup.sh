#!/bin/bash
# setup.sh — radar feature (LD2450 presence detection).
#
# Installs Python deps + the `radar` systemd unit, then enables + starts the
# daemon.
set -e
. "$(cd "$(dirname "$0")/../../shared" && pwd)/setup-lib.sh"

echo "── radar ──"
pip_install pyserial paho-mqtt RPi.GPIO
init_db
install_sudoers

# Enable UART (hardware serial ON, serial login console OFF) — best-effort.
if command -v raspi-config >/dev/null 2>&1; then
  echo "▸ Enabling UART (raspi-config nonint)…"
  sudo raspi-config nonint do_serial_hw 0 2>/dev/null || true
  sudo raspi-config nonint do_serial_cons 1 2>/dev/null || true
fi

install_unit radar "LD2450 Radar Presence Detection" "features.radar.daemon"
enable_unit radar
systemctl status --no-pager --lines=0 radar || true

echo
echo "✓ Radar installed (unit: radar)."
echo "  If the daemon can't read /dev/ttyAMA0: a REBOOT is needed; on Pi 3/4/Zero 2"
echo "  also add dtoverlay=disable-bt in /boot/firmware/config.txt."
