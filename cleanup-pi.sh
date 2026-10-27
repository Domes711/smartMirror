#!/bin/bash
# cleanup-pi.sh — FULL reset of stale Pi state before a fresh clone + ./setup.sh.
#
# Single-source model: the live mirror will run from the clone
# (~/smartMirror/MagicMirror), so the standalone ~/MagicMirror and ~/ld2450 are
# removed, along with the mic feature's external checkouts
# (~/wyoming-satellite, ~/wyoming-openwakeword). Removes our systemd units,
# pm2 app + its boot hook, manual processes, sudoers, our mosquitto listener
# config, and any @reboot/autostart entries that launch the mirror.
#
# Deliberately does NOT back up anything — real config (calendar ID,
# passwords…) and per-Pi state (backend/var/: the SQLite DB, enrolled faces,
# module assets/drafts) are gone once this runs. Back them up yourself first
# if you need them (e.g. `cp -a backend/var ~/backend-var-backup`).
#
# Usage (on the Pi):  ~/smartMirror/cleanup-pi.sh
set -u

# --- systemd units ------------------------------------------------------
echo "▸ Removing systemd units…"
for svc in mirror-gateway camera-supervisor camera-recognition modules ai-modules scenes display radar mic wyoming-satellite wyoming-openwakeword mirror-control; do
  sudo systemctl stop "$svc" 2>/dev/null || true
  sudo systemctl disable "$svc" 2>/dev/null || true
  sudo rm -f "/etc/systemd/system/$svc.service"
done
sudo systemctl daemon-reload
sudo systemctl reset-failed 2>/dev/null || true

# --- pm2 (app + boot hook) ---------------------------------------------
echo "▸ Removing pm2 app + boot autostart…"
pm2 delete MagicMirror 2>/dev/null || true
pm2 save --force 2>/dev/null || true
pm2 unstartup systemd 2>/dev/null || true
sudo systemctl disable "pm2-$(id -un)" 2>/dev/null || true
sudo rm -f "/etc/systemd/system/pm2-$(id -un).service"
pm2 kill 2>/dev/null || true

# --- manual processes ---------------------------------------------------
echo "▸ Killing stray manual processes…"
for p in "features.camera.daemon" "features.camera.recognition_daemon" "features.radar.daemon" "features.display.daemon" "features.scenes.service" "features.modules.daemon" "features.ai_modules.daemon" "features.mic.daemon" "gateway" "start-magicmirror.sh"; do
  pkill -f "$p" 2>/dev/null || true
done

# --- sudoers ------------------------------------------------------------
sudo rm -f /etc/sudoers.d/mirror-console /etc/sudoers.d/smartmirror

# --- @reboot / desktop autostart ---------------------------------------
echo "▸ Stripping autostart entries…"
if crontab -l >/dev/null 2>&1; then
  crontab -l | grep -vEi 'start-magicmirror|/MagicMirror|smartMirror|mirror-console' | crontab - 2>/dev/null || true
fi
LX="$HOME/.config/lxsession/LXDE-pi/autostart"
if [ -f "$LX" ]; then
  sed -i '/start-magicmirror/Id; /MagicMirror/Id' "$LX" 2>/dev/null || true
fi
if [ -d "$HOME/.config/autostart" ]; then
  for de in "$HOME/.config/autostart/"*; do
    [ -f "$de" ] && grep -qiE 'magicmirror|start-magicmirror' "$de" && rm -f "$de"
  done
fi

# --- obsolete standalone dirs (single source = the clone) --------------
echo "▸ Removing standalone ~/MagicMirror and ~/ld2450…"
rm -rf "$HOME/MagicMirror" "$HOME/ld2450"

# --- mic feature's external clones (features/mic/setup.sh) -------------
# Upstream git checkouts + their own .venv, cloned under $HOME (not backend/,
# since they are not this repo's code — see backend/README.md's mic section).
# Nothing per-Pi lives here — the actual settings (device/wake_word/…) are
# mic_config rows in backend/var/smartmirror.db, not these checkouts.
echo "▸ Removing wyoming-satellite / wyoming-openwakeword checkouts…"
rm -rf "$HOME/wyoming-satellite" "$HOME/wyoming-openwakeword"

# --- mosquitto config written by features/camera/setup.sh --------------
# mosquitto itself stays (it may serve other things on this machine); only
# our listener config goes, so a fresh setup.sh starts from a clean slate
# instead of layering on top of a possibly-stale smartmirror.conf.
echo "▸ Removing our mosquitto listener config…"
sudo rm -f /etc/mosquitto/conf.d/smartmirror.conf
sudo systemctl restart mosquitto 2>/dev/null || true

echo
echo "════════════════════════════════════════════"
echo "✓ Pi cleaned up. Nothing was backed up."
echo "════════════════════════════════════════════"
echo "Next (clean clone + autosetup):"
echo "    cd ~ && rm -rf smartMirror"
echo "    git clone <repo-url> smartMirror"
echo "    cd smartMirror && ./setup.sh"
