#!/bin/bash
# nuke-pi.sh — TOTAL Pi reset: everything cleanup-pi.sh does, PLUS deleting the
# ~/smartMirror checkout itself. Use before a from-scratch bootstrap.
#
# Backups are safe: cleanup-pi.sh first copies your real config, enrolled faces
# (camera/dataset + encoded_faces.pickle) and per-Pi state (radar calibration,
# layout store) to ~/mirror-backup-<timestamp>/ — OUTSIDE the repo — so deleting
# ~/smartMirror does NOT lose them.
#
# Usage (on the Pi):  ~/smartMirror/nuke-pi.sh
#                or:  bash nuke-pi.sh          (from inside the repo)
# Override target dir: SMARTMIRROR_DIR=… bash nuke-pi.sh
set -u

DIR="${SMARTMIRROR_DIR:-$HOME/smartMirror}"

# Locate cleanup-pi.sh: prefer the sibling of THIS script, then the repo dir.
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
CLEAN=""
for c in "$SELF_DIR/cleanup-pi.sh" "$DIR/cleanup-pi.sh"; do
  [ -f "$c" ] && { CLEAN="$c"; break; }
done

echo "════════════════════════════════════════════"
echo "  Smart Mirror — TOTAL cleanup (nuke)"
echo "  smaže: $DIR  (+ vše co cleanup-pi.sh)"
echo "════════════════════════════════════════════"

if [ -n "$CLEAN" ]; then
  echo "▸ Standardní cleanup ($CLEAN) — zálohy + units/pm2/autostart/sudoers…"
  bash "$CLEAN" || echo "⚠ cleanup-pi.sh skončil s chybou — pokračuji k mazání složky"
else
  echo "⚠ cleanup-pi.sh nenalezen — přeskakuji standardní cleanup."
  echo "  systemd units / pm2 / autostart NEMUSÍ být odstraněny. Pokud na Pi"
  echo "  ještě běží mirror, spusť cleanup-pi.sh ručně před nuke."
fi

# cd out of the repo before deleting it (the running script's fd stays valid).
cd "$HOME"
echo "▸ Mažu $DIR …"
rm -rf "$DIR"

echo
echo "════════════════════════════════════════════"
echo "✓ Total cleanup hotov — $DIR smazán."
echo "  Záloha: ~/mirror-backup-*  (config, naučené obličeje, kalibrace, layout)"
echo "════════════════════════════════════════════"
echo "Čistý start (clone + full setup):"
echo "    bash ~/bootstrap.sh"
echo "Po startu obnov ze zálohy:"
echo "  • ~/mirror-backup-*/MagicMirror-config/config.js → MagicMirror/config/config.js"
echo "  • ~/mirror-backup-*/dataset/.                     → camera/dataset/"
echo "  • ~/mirror-backup-*/encoded_faces.pickle          → camera/"
