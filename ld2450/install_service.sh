#!/bin/bash
# Install ld2450 radar daemon as systemd service

set -e

echo "Installing ld2450 radar daemon service..."

# 1. Copy service file to systemd directory
sudo cp ld2450.service /etc/systemd/system/

# 2. Reload systemd to recognize new service
sudo systemctl daemon-reload

# 3. Enable service to start on boot
sudo systemctl enable ld2450

# 4. Start service now
sudo systemctl start ld2450

# 5. Show status
echo ""
echo "✓ Service installed and started!"
echo ""
echo "Check status with:"
echo "  sudo systemctl status ld2450"
echo ""
echo "View logs with:"
echo "  sudo journalctl -u ld2450 -f"
echo ""
echo "Control service with:"
echo "  sudo systemctl start|stop|restart ld2450"
