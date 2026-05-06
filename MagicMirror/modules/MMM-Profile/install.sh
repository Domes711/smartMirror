#!/bin/bash
# Install/update MMM-Profile module from smartMirror repo to MagicMirror

set -e  # Exit on error

MODULE_NAME="MMM-Profile"
SOURCE_DIR="$HOME/smartMirror/MagicMirror/modules/$MODULE_NAME"
TARGET_DIR="$HOME/MagicMirror/modules/$MODULE_NAME"

echo "=== Installing $MODULE_NAME ==="
echo

# Check if source exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: Source directory not found: $SOURCE_DIR"
    exit 1
fi

# Remove existing module
if [ -d "$TARGET_DIR" ]; then
    echo "🗑️  Removing existing module at $TARGET_DIR"
    rm -rf "$TARGET_DIR"
fi

# Create target directory
echo "📁 Creating target directory: $TARGET_DIR"
mkdir -p "$TARGET_DIR"

# Copy module files
echo "📦 Copying module files..."
cp -r "$SOURCE_DIR"/* "$TARGET_DIR"/

# Install npm dependencies
echo "📥 Installing npm dependencies..."
cd "$TARGET_DIR"
npm install

echo
echo "✅ $MODULE_NAME installed successfully!"
echo
echo "🔄 Restart MagicMirror to load the module:"
echo "   pm2 restart MagicMirror"
