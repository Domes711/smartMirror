#!/bin/bash
# start-magicmirror.sh
#
# Starts MagicMirror (Electron) and ATTACHES to the running graphical session
# on the physical screen — even when the script is launched over SSH / pm2 /
# at boot (where the shell itself has no DISPLAY/WAYLAND). Autodetects
# Wayland vs X11.
#
# Assumption: a desktop session is running on the Pi (raspi-config → Boot →
# Desktop Autologin).

# runtime dir of the logged-in user (where the wayland sockets live)
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# wait for the graphical session to come up (wayland socket or X :0), max ~30s
for _ in $(seq 1 30); do
  if ls "$XDG_RUNTIME_DIR"/wayland-* >/dev/null 2>&1 || [ -e /tmp/.X11-unix/X0 ]; then
    break
  fi
  sleep 1
done

# hide the cursor (runs inside that session)
unclutter -idle 0 >/dev/null 2>&1 &

cd "$(cd "$(dirname "$0")" && pwd)"

# pick Wayland or X11 based on what's actually running, set the right env
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
