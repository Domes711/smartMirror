#!/bin/bash
# setup.sh — install monitor-control daemon as systemd service

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MONITOR_DIR="$REPO_DIR/monitor-control"

echo "▸ Installing monitor-control daemon..."

# Install Python dependencies
echo "  Installing Python dependencies..."
pip3 install --user paho-mqtt

# Make monitor_control.py executable
chmod +x "$MONITOR_DIR/monitor_control.py"

# Install systemd service
echo "  Installing systemd service..."
sudo cp "$MONITOR_DIR/monitor-control.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable monitor-control.service
sudo systemctl restart monitor-control.service

echo "✓ Monitor control daemon installed and started"
echo ""
echo "  Status:  sudo systemctl status monitor-control"
echo "  Logs:    journalctl -u monitor-control -f"
echo ""
echo "MQTT Topics:"
echo "  smartmirror/monitor/control/brightness   - 0-100"
echo "  smartmirror/monitor/control/contrast     - 0-100"
echo "  smartmirror/monitor/control/power        - on/off/standby"
echo "  smartmirror/monitor/control/mode         - standard/movie/games"
echo "  smartmirror/monitor/control/preset       - 5000K/6500K/7500K/9300K/10000K/user1/user2"
echo "  smartmirror/monitor/control/rgb          - {\"r\":100,\"g\":100,\"b\":100}"
echo "  smartmirror/monitor/control/e2           - 0-25"
echo "  smartmirror/monitor/control/refresh      - trigger state publish"
echo ""
echo "  smartmirror/monitor/state                - current state (published)"
