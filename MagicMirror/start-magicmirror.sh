#!/bin/bash
# start-magicmirror.sh

# nastavíme DISPLAY, aby Electron věděl, kde vykreslovat
export DISPLAY=:0

# čekáme, až X server naběhne
sleep 10

# schováme kurzor
unclutter -idle 0 &

# spustíme MagicMirror (cesta podle umístění tohoto skriptu)
cd "$(cd "$(dirname "$0")" && pwd)"
npm start
