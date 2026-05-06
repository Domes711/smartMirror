#!/usr/bin/env bash
#
# Install Node.js 24 LTS (or whatever NODE_MAJOR is set to) on the Raspberry Pi
# and rebuild MagicMirror + custom modules against the new Node ABI.
#
# Method: NodeSource apt repository (system-wide, simple, survives reboots).
# Tested on Pi OS Bookworm 64-bit.
#
# Usage (on the Pi):
#   bash ~/smartMirror/tests/install_node_lts.sh
#
# Override the major version:
#   NODE_MAJOR=26 bash ~/smartMirror/tests/install_node_lts.sh
#
# Dry run — print steps without executing:
#   DRY_RUN=1 bash ~/smartMirror/tests/install_node_lts.sh

set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-24}"
MM_DIR="${MM_DIR:-$HOME/MagicMirror}"
DRY_RUN="${DRY_RUN:-0}"

run() {
    echo
    echo ">>> $*"
    [[ "$DRY_RUN" == "1" ]] && return 0
    eval "$@"
}

confirm() {
    read -r -p "$1 [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]]
}

echo "================================================================"
echo " Node.js ${NODE_MAJOR} LTS install + MagicMirror rebuild"
echo " MagicMirror dir: ${MM_DIR}"
echo " Dry run:         ${DRY_RUN}"
echo "================================================================"

if [[ ! -d "$MM_DIR" ]]; then
    echo "ERROR: ${MM_DIR} not found. Set MM_DIR=... if MagicMirror lives elsewhere."
    exit 1
fi

if ! confirm "This will stop MagicMirror, replace Node, and rebuild modules. Continue?"; then
    echo "Aborted."
    exit 0
fi

# ---- 1. Stop everything that uses Node ---------------------------------
echo
echo "### 1. Stop MagicMirror / pm2"
run "pm2 stop all || true"
run "pm2 kill   || true"

# ---- 2. Show current state --------------------------------------------
echo
echo "### 2. Current state"
run "node -v 2>/dev/null || echo 'no node installed'"
run "which node || true"
run "uname -m"

# ---- 3. Remove any old apt-managed node -------------------------------
echo
echo "### 3. Remove old apt node"
run "sudo apt remove --purge -y nodejs npm || true"
run "sudo apt autoremove --purge -y"

# ---- 4. Add NodeSource repo for the chosen major ----------------------
echo
echo "### 4. Add NodeSource repo (Node ${NODE_MAJOR}.x)"
run "curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -"
run "sudo apt install -y nodejs"

# ---- 5. Verify --------------------------------------------------------
echo
echo "### 5. Verify"
run "node -v"
run "npm -v"
run "which node"

# ---- 6. Reinstall pm2 globally + systemd hook -------------------------
echo
echo "### 6. Reinstall pm2"
run "sudo npm install -g pm2"
echo
echo "Run the command pm2 prints below as root to register pm2 with systemd."
run "pm2 startup systemd -u \"$USER\" --hp \"$HOME\" || true"

# ---- 7. Rebuild MagicMirror core --------------------------------------
echo
echo "### 7. Rebuild MagicMirror core"
run "cd \"$MM_DIR\" && rm -rf node_modules package-lock.json"
run "cd \"$MM_DIR\" && npm install"

# ---- 8. Rebuild every module that has package.json --------------------
echo
echo "### 8. Rebuild modules with package.json"
for d in "$MM_DIR"/modules/*/; do
    name="$(basename "$d")"
    [[ "$name" == "default" ]] && continue
    if [[ -f "$d/package.json" ]]; then
        echo
        echo "--- $name ---"
        run "cd \"$d\" && rm -rf node_modules package-lock.json"
        run "cd \"$d\" && npm install"
    fi
done

# ---- 9. Start MagicMirror back up -------------------------------------
echo
echo "### 9. Start MagicMirror"
run "cd \"$MM_DIR\" && pm2 start npm --name MagicMirror -- run start"
run "pm2 save"

# ---- 10. Final sanity check -------------------------------------------
echo
echo "### 10. Final state"
run "node -v"
run "pm2 status"
run "systemctl is-active ld2450.service || true"

echo
echo "Done. If MagicMirror does not render, check:"
echo "  pm2 logs MagicMirror --lines 100"
echo "  journalctl -u ld2450.service --since '5 min ago'"
