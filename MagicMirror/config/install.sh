#!/bin/bash
# Install/update MagicMirror config files from smartMirror repo to MagicMirror

set -e  # Exit on error

SOURCE_DIR="$HOME/smartMirror/MagicMirror/config"
TARGET_DIR="$HOME/MagicMirror/config"

echo "=== Installing MagicMirror config files ==="
echo

# Check if source exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: Source directory not found: $SOURCE_DIR"
    exit 1
fi

# Backup existing config files
if [ -f "$TARGET_DIR/config.js" ]; then
    echo "📦 Backing up existing config.js to config.js.backup"
    cp "$TARGET_DIR/config.js" "$TARGET_DIR/config.js.backup"
fi

if [ -f "$TARGET_DIR/pages.js" ]; then
    echo "📦 Backing up existing pages.js to pages.js.backup"
    cp "$TARGET_DIR/pages.js" "$TARGET_DIR/pages.js.backup"
fi

# Copy config files
echo "📁 Copying config.js..."
cp "$SOURCE_DIR/config.js" "$TARGET_DIR/config.js"

echo "📁 Copying pages.js..."
cp "$SOURCE_DIR/pages.js" "$TARGET_DIR/pages.js"

echo
echo "✅ Config files installed successfully!"
echo
echo "🔄 Restart MagicMirror to load the new config:"
echo "   pm2 restart MagicMirror"
