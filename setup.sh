#!/bin/bash
# setup.sh — master installer for the whole smart mirror.
#
# Fresh Pi flow:
#   git clone <repo> smartMirror
#   cd smartMirror && ./setup.sh
#
# Runs each component's own setup.sh (camera, radar, console, MagicMirror) and
# installs the sudoers rule that lets the console control the daemons.
#
# NOTE: components are independent — a failure in one (e.g. a slow dlib/mediapipe
# build in camera) must NOT abort the rest, so MagicMirror still comes up.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"

# Self-bootstrap: if this file was dropped OUTSIDE the repo (the component dirs
# aren't next to it), clone/update the repo into ~/smartMirror and hand off to
# its setup.sh. Lets you copy JUST this one file to a fresh Pi and run it.
# Override: SMARTMIRROR_REPO=…  SMARTMIRROR_BRANCH=…  SMARTMIRROR_DIR=…
if [ ! -f "$DIR/mirror-console/setup.sh" ] || [ ! -f "$DIR/MagicMirror/setup.sh" ]; then
  TARGET="${SMARTMIRROR_DIR:-$HOME/smartMirror}"
  if [ "$DIR" = "$TARGET" ]; then
    echo "✗ Repo v $TARGET je neúplný (chybí komponentní setup.sh)."
    echo "  Smaž ho (nuke-pi.sh) a spusť setup.sh znovu mimo repo."
    exit 1
  fi
  REPO_URL="${SMARTMIRROR_REPO:-git@github.com:Domes711/smartMirror.git}"
  BRANCH="${SMARTMIRROR_BRANCH:-master}"
  if ! command -v git >/dev/null 2>&1; then
    echo "✗ git není nainstalován (sudo apt-get install -y git)"; exit 1
  fi
  echo "▸ setup.sh běží mimo repo ($DIR) — bootstrap → $TARGET"
  if [ -d "$TARGET/.git" ]; then
    git -C "$TARGET" fetch origin "$BRANCH" 2>/dev/null && git -C "$TARGET" checkout "$BRANCH" 2>/dev/null
    git -C "$TARGET" pull --ff-only origin "$BRANCH" || echo "⚠ pull selhal — pokračuji se stávajícím checkoutem"
  else
    echo "▸ Klonuji $REPO_URL ($BRANCH) → $TARGET"
    git clone --branch "$BRANCH" "$REPO_URL" "$TARGET" \
      || { echo "✗ git clone selhal — zkontroluj SSH klíč, nebo: SMARTMIRROR_REPO=https://github.com/Domes711/smartMirror.git bash setup.sh"; exit 1; }
  fi
  exec bash "$TARGET/setup.sh"
fi

cd "$DIR"

FAILED=""
run() {  # run "Label" /path/to/setup.sh
  echo
  echo "── $1 ──"
  if bash "$2"; then echo "✓ $1"; else echo "✗ $1 — pokračuji (viz chyba výše)"; FAILED="$FAILED $1"; fi
}

echo "════════════════════════════════════════════"
echo "  Smart Mirror — master setup ($DIR)"
echo "════════════════════════════════════════════"

echo
echo "── sudoers (console controls face_reco / ld2450) ──"
sudo cp "$DIR/mirror-console/sudoers.d/mirror-console" /etc/sudoers.d/mirror-console || true
sudo visudo -cf /etc/sudoers.d/mirror-console || true

# ── mm-store (private module catalog: store/modules/<MMM-Name>/mm-store.json) ──
# Gitignored, lives in its own private repo. Cloned here so the store shows the
# curated cs/en names, descriptions and tags. Override the URL with:
#   MM_STORE_REPO=... ./setup.sh
MM_STORE_REPO="${MM_STORE_REPO:-git@github.com:Domes711/MMM-store.git}"
echo
echo "── mm-store (store/) ──"
if [ -d "$DIR/store/.git" ]; then
  if git -C "$DIR/store" pull --ff-only; then echo "✓ mm-store aktualizován"; else echo "✗ mm-store pull selhal — pokračuji"; fi
elif [ -e "$DIR/store" ] && [ -n "$(ls -A "$DIR/store" 2>/dev/null)" ]; then
  echo "• store/ už existuje (není to git repo) — nechávám beze změny"
elif git clone --depth 1 "$MM_STORE_REPO" "$DIR/store"; then
  echo "✓ mm-store naklonován ($MM_STORE_REPO)"
else
  echo "✗ mm-store clone selhal ($MM_STORE_REPO) — zkontroluj přístup (SSH klíč) / nastav MM_STORE_REPO; pokračuji"
fi

run "1/4  Camera (face recognition)" "$DIR/camera/setup.sh"
run "2/4  Radar (LD2450)"            "$DIR/ld2450/setup.sh"
run "3/4  Mirror console"            "$DIR/mirror-console/setup.sh"
run "4/4  MagicMirror (+ pm2)"       "$DIR/MagicMirror/setup.sh"

echo
echo "════════════════════════════════════════════"
if [ -n "$FAILED" ]; then
  echo "  ⚠ Dokončeno s chybami v:$FAILED"
  echo "    (ostatní části běží; chybnou část oprav a spusť její setup.sh zvlášť)"
else
  echo "  ✓ Hotovo."
fi
echo "════════════════════════════════════════════"
echo "Automatizováno: sudoers, mm-store clone (store/), UART (raspi-config), pm2 autostart."
echo
echo "Ruční (citlivé / vyžaduje rozhodnutí):"
echo "  • REBOOT pokud se UART zapnul poprvé (radar pak uvidí /dev/ttyAMA0)."
echo "  • Po cleanu obnov REÁLNÝ config (calendar ID, hesla) ze zálohy:"
echo "       ~/mirror-backup-*/MagicMirror-config/config.js → MagicMirror/config/config.js"
echo
echo "Ověření:"
echo "  curl -s http://127.0.0.1:8000/healthz; echo      # konzole"
echo "  systemctl status ld2450 mirror-console-backend mirror-console-web"
echo "  pm2 status MagicMirror"
