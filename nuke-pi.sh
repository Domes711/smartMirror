#!/bin/bash
# nuke-pi.sh — TOTAL Pi reset: everything cleanup-pi.sh does, PLUS deleting the
# ~/smartMirror checkout itself. Use before a from-scratch bootstrap.
#
# Deliberately does NOT back up anything (neither this script nor
# cleanup-pi.sh does) — real config, the SQLite DB, enrolled faces, module
# assets/drafts, all of it is gone once this runs. Back up backend/var/ and
# MagicMirror/config/config.js yourself first if you need them.
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
echo "  deletes: $DIR  (+ everything cleanup-pi.sh does)"
echo "════════════════════════════════════════════"

if [ -n "$CLEAN" ]; then
  echo "▸ Standard cleanup ($CLEAN) — units/pm2/autostart/sudoers (no backup)…"
  bash "$CLEAN" || echo "⚠ cleanup-pi.sh exited with an error — continuing to delete the directory"
else
  echo "⚠ cleanup-pi.sh not found — skipping standard cleanup."
  echo "  systemd units / pm2 / autostart may NOT be removed. If the mirror"
  echo "  is still running on this Pi, run cleanup-pi.sh manually before nuking."
fi

# cd out of the repo before deleting it (the running script's fd stays valid).
cd "$HOME"
echo "▸ Deleting $DIR …"
rm -rf "$DIR"

echo
echo "════════════════════════════════════════════"
echo "✓ Total cleanup done — $DIR deleted. Nothing was backed up."
echo "════════════════════════════════════════════"
echo "Clean start (clone + full setup) — copy setup.sh to ~ and run:"
echo "    bash ~/setup.sh        # outside the repo it self-clones + runs setup"
