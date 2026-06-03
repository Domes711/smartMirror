#!/bin/bash
# start-magicmirror.sh
#
# Spouští MagicMirror (Electron) a PŘIPOJÍ se k běžící grafické session na
# fyzické obrazovce — i když je skript spuštěný přes SSH / pm2 / po bootu
# (kde shell sám DISPLAY/WAYLAND nemá). Autodetekce Wayland vs X11.
#
# Předpoklad: na Pi běží desktop session (raspi-config → Boot → Desktop Autologin).

# runtime adresář přihlášeného uživatele (kde žijí wayland sockety)
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# počkej až grafická session naběhne (wayland socket nebo X :0), max ~30 s
for _ in $(seq 1 30); do
  if ls "$XDG_RUNTIME_DIR"/wayland-* >/dev/null 2>&1 || [ -e /tmp/.X11-unix/X0 ]; then
    break
  fi
  sleep 1
done

# schováme kurzor (běží v dané session)
unclutter -idle 0 >/dev/null 2>&1 &

cd "$(cd "$(dirname "$0")" && pwd)"

# vyber Wayland nebo X11 podle toho, co reálně běží, a nastav správné prostředí
WL="$(ls "$XDG_RUNTIME_DIR"/wayland-* 2>/dev/null | head -1)"
if [ -n "$WL" ]; then
  export WAYLAND_DISPLAY="$(basename "$WL")"
  echo "start-magicmirror: Wayland session ($WAYLAND_DISPLAY)"
  exec npm run start:wayland
else
  export DISPLAY="${DISPLAY:-:0}"
  export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
  echo "start-magicmirror: X11 session ($DISPLAY)"
  exec npm run start:x11
fi
