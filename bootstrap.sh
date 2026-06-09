#!/bin/bash
# bootstrap.sh — one-shot Pi bootstrap: clone the smartMirror repo, then run its
# full setup. Copy JUST this file to the Pi and run it — it does everything
# ./setup.sh does, PLUS cloning the repo itself.
#
#   scp bootstrap.sh admin@10.0.0.249:~
#   ssh admin@10.0.0.249 'bash ~/bootstrap.sh'
#
# Clones into ~/smartMirror (git pull if it already exists), then runs
# ./setup.sh (which in turn also clones the private mm-store into store/).
# Override repo / branch / target dir:
#   SMARTMIRROR_REPO=…  SMARTMIRROR_BRANCH=…  SMARTMIRROR_DIR=…  bash bootstrap.sh
set -u

REPO_URL="${SMARTMIRROR_REPO:-git@github.com:Domes711/smartMirror.git}"
BRANCH="${SMARTMIRROR_BRANCH:-master}"
DIR="${SMARTMIRROR_DIR:-$HOME/smartMirror}"

echo "════════════════════════════════════════════"
echo "  Smart Mirror — bootstrap"
echo "  repo:   $REPO_URL"
echo "  branch: $BRANCH"
echo "  dir:    $DIR"
echo "════════════════════════════════════════════"

if ! command -v git >/dev/null 2>&1; then
  echo "✗ git není nainstalován (sudo apt-get install -y git)"; exit 1
fi

if [ -d "$DIR/.git" ]; then
  echo "▸ $DIR už existuje — aktualizuji (git pull)"
  git -C "$DIR" fetch origin "$BRANCH" || { echo "✗ git fetch selhal"; exit 1; }
  git -C "$DIR" checkout "$BRANCH" 2>/dev/null || true
  git -C "$DIR" pull --ff-only origin "$BRANCH" || echo "⚠ pull selhal — pokračuji se stávajícím checkoutem"
else
  echo "▸ Klonuji $REPO_URL ($BRANCH) → $DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$DIR" \
    || { echo "✗ git clone selhal — zkontroluj přístup (SSH klíč) / SMARTMIRROR_REPO"; exit 1; }
fi

echo "▸ Spouštím setup.sh"
cd "$DIR" || { echo "✗ cd $DIR selhal"; exit 1; }
exec bash ./setup.sh
