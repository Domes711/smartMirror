#!/bin/bash
# Deploy all custom modules and scripts to Raspberry Pi

set -e  # Exit on error

PI_HOST="admin@10.0.0.249"
MODULES=(
    "MMM-Profile"
    "MMM-Brno-Transit"
    "MMM-HA-Reminders"
    "MMM-Mail"
    "MMM-Spending"
    "MMM-GoogleCalendar"
    "MMM-Package-Tracker"
)

echo "=== Deploying to Pi @ $PI_HOST ==="
echo

# Copy MagicMirror modules
echo "📦 Copying MagicMirror modules..."
for module in "${MODULES[@]}"; do
    echo "  → $module"
    rsync -avz --delete \
        "MagicMirror/modules/$module/" \
        "$PI_HOST:~/MagicMirror/modules/$module/"
done
echo

# Copy camera scripts
echo "📷 Copying camera scripts..."
rsync -avz --delete \
    camera/ \
    "$PI_HOST:~/smartMirror/camera/"
echo

# Copy ld2450 scripts and service
echo "📡 Copying ld2450 radar daemon..."
rsync -avz --delete \
    ld2450/ \
    "$PI_HOST:~/smartMirror/ld2450/"
echo

# Run npm install for each module
echo "📥 Running npm install for each module..."
for module in "${MODULES[@]}"; do
    echo "  → $module"
    ssh "$PI_HOST" "cd ~/MagicMirror/modules/$module && npm install" || echo "    ⚠️  npm install failed or no package.json"
done
echo

# Restart services
echo "🔄 Restarting services..."
echo "  → Restarting MagicMirror (pm2)"
ssh "$PI_HOST" "pm2 restart MagicMirror"

echo "  → Restarting face_reco.service"
ssh "$PI_HOST" "sudo systemctl restart face_reco.service" || echo "    ⚠️  face_reco.service not running"

echo "  → Restarting ld2450.service"
ssh "$PI_HOST" "sudo systemctl restart ld2450.service" || echo "    ⚠️  ld2450.service not running"

echo
echo "✅ Deployment complete!"
echo
echo "📊 Check status:"
echo "  pm2 logs MagicMirror"
echo "  sudo journalctl -u face_reco.service -f"
echo "  sudo journalctl -u ld2450.service -f"
