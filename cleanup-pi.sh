#!/bin/bash
# cleanup-pi.sh — FULL reset of stale Pi state before a fresh clone + ./setup.sh.
#
# Single-source model: the live mirror will run from the clone
# (~/smartMirror/MagicMirror), so the standalone ~/MagicMirror and ~/ld2450 are
# removed. Removes our systemd units, pm2 app + its boot hook, manual
# processes, sudoers, and any @reboot/autostart entries that launch the mirror.
#
# Safe by design: backs up your real config + per-Pi state + any files it edits
# to ~/mirror-backup-<timestamp>/ first. Leaves mosquitto, pip packages, and the
# current repo checkout alone (you re-clone that yourself afterwards).
#
# Usage (on the Pi):  ~/smartMirror/cleanup-pi.sh
set -u

BK="$HOME/mirror-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
echo "▸ Backup → $BK"

# --- back up anything valuable / not in git -----------------------------
[ -d "$HOME/MagicMirror/config" ] && cp -a "$HOME/MagicMirror/config" "$BK/MagicMirror-config" 2>/dev/null || true
for f in \
  "$HOME/smartMirror/ld2450/radar_config.json" \
  "$HOME/smartMirror/mirror-console/backend/layout_store.json" \
  "$HOME/MagicMirror/config/console-modules.js"; do
  [ -f "$f" ] && cp -a "$f" "$BK/" 2>/dev/null || true
done
# Face training data + model are NOT in git (only .gitkeep) — back them up,
# otherwise a fresh clone loses all enrolled faces.
REPO="$(cd "$(dirname "$0")" && pwd)"
[ -d "$REPO/camera/dataset" ] && cp -a "$REPO/camera/dataset" "$BK/dataset" 2>/dev/null || true
[ -f "$REPO/camera/encoded_faces.pickle" ] && cp -a "$REPO/camera/encoded_faces.pickle" "$BK/" 2>/dev/null || true
crontab -l > "$BK/crontab.bak" 2>/dev/null || true

# --- systemd units ------------------------------------------------------
echo "▸ Removing systemd units…"
for svc in mirror-console-web mirror-console-backend mirror-control ld2450 face_reco; do
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
for p in "backend/supervisor.py" "server/index.js" "ld2450_daemon.py" "face_reco_daemon.py" "start-magicmirror.sh"; do
  pkill -f "$p" 2>/dev/null || true
done

# --- sudoers ------------------------------------------------------------
sudo rm -f /etc/sudoers.d/mirror-console

# --- @reboot / desktop autostart ---------------------------------------
echo "▸ Stripping autostart entries…"
if crontab -l >/dev/null 2>&1; then
  crontab -l | grep -vEi 'start-magicmirror|/MagicMirror|smartMirror|mirror-console' | crontab - 2>/dev/null || true
fi
LX="$HOME/.config/lxsession/LXDE-pi/autostart"
if [ -f "$LX" ]; then
  cp -a "$LX" "$BK/lxsession-autostart.bak"
  sed -i '/start-magicmirror/Id; /MagicMirror/Id' "$LX" 2>/dev/null || true
fi
if [ -d "$HOME/.config/autostart" ]; then
  for de in "$HOME/.config/autostart/"*; do
    [ -f "$de" ] && grep -qiE 'magicmirror|start-magicmirror' "$de" && { cp -a "$de" "$BK/"; rm -f "$de"; }
  done
fi

# --- obsolete standalone dirs (single source = the clone) --------------
echo "▸ Removing standalone ~/MagicMirror and ~/ld2450…"
rm -rf "$HOME/MagicMirror" "$HOME/ld2450"

echo
echo "════════════════════════════════════════════"
echo "✓ Pi vyčištěn. Záloha: $BK"
echo "════════════════════════════════════════════"
echo "Dál (čistý clone + autosetup):"
echo "    cd ~ && rm -rf smartMirror"
echo "    git clone <repo-url> smartMirror"
echo "    cd smartMirror && ./setup.sh"
echo
echo "⚠ Po čistém clonu obnov ze zálohy ($BK):"
echo "  • REÁLNÝ config (calendar ID, hesla…):"
echo "      cp $BK/MagicMirror-config/config.js ~/smartMirror/MagicMirror/config/config.js"
echo "  • NAUČENÉ OBLIČEJE (fotky + model — nejsou v gitu!):"
echo "      cp -a $BK/dataset/. ~/smartMirror/camera/dataset/"
echo "      cp -a $BK/encoded_faces.pickle ~/smartMirror/camera/ 2>/dev/null"
echo "  • Kalibrace radaru / layout store jsou taky v záloze (jinak se přenastaví)."
