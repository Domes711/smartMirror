#!/bin/bash
# setup.sh — Display control daemon installer.
#
# Installs and enables the display-control systemd service.

set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "▸ Installing display-control systemd service..."

# Check for required Python packages
if ! python3 -c "import paho.mqtt.client" 2>/dev/null; then
  echo "  Installing paho-mqtt..."
  pip3 install paho-mqtt || sudo apt-get install -y python3-paho-mqtt
fi

# Install systemd service
sudo cp "$DIR/systemd/display-control.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable display-control

echo "  ✓ display-control service installed and enabled"
echo
echo "  Start with: sudo systemctl start display-control"
echo "  View logs:  journalctl -u display-control -f"
echo
echo "  Optional: Install ddcutil for brightness control"
echo "    sudo apt install ddcutil"
