#!/bin/bash
# apply-satellite-unit.sh — regenerate wyoming-satellite.service from the
# template and restart it, so a `mic_config` change (device/satellite_name/
# wake_word) over MQTT actually takes effect on the live unit instead of only
# updating the DB until the next manual setup.sh run.
#
# Invoked as root via sudoers (NOPASSWD, this exact path — see
# shared/sudoers.d/smartmirror) by features/mic/service.py, which runs as the
# unprivileged `admin` user and cannot write /etc/systemd/system/ or
# `systemctl daemon-reload` on its own.
#
# Usage: sudo apply-satellite-unit.sh <device> <satellite_name> <wake_word>
set -euo pipefail

[ "$(id -u)" = "0" ] || { echo "must run as root" >&2; exit 1; }
[ $# -eq 3 ] || { echo "usage: $0 <device> <satellite_name> <wake_word>" >&2; exit 1; }

DEVICE="$1"
SATELLITE_NAME="$2"
WAKE_WORD="$3"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="$(logname 2>/dev/null || echo admin)"
RUN_GROUP="$(id -gn "$RUN_USER" 2>/dev/null || echo "$RUN_USER")"
SATELLITE_DIR="$(eval echo "~$RUN_USER")/wyoming-satellite"

# Was it running before we touch the unit? Restart only if so — a disabled/
# stopped satellite (e.g. mid test-recording) must stay stopped.
WAS_ACTIVE=0
systemctl is-active --quiet wyoming-satellite && WAS_ACTIVE=1

sed \
  -e "s|__USER__|${RUN_USER}|g" \
  -e "s|__GROUP__|${RUN_GROUP}|g" \
  -e "s|__SATELLITE_DIR__|${SATELLITE_DIR}|g" \
  -e "s|__SATELLITE_NAME__|${SATELLITE_NAME}|g" \
  -e "s|__DEVICE__|${DEVICE}|g" \
  -e "s|__WAKE_WORD__|${WAKE_WORD}|g" \
  "$HERE/wyoming-satellite.service" > /etc/systemd/system/wyoming-satellite.service

systemctl daemon-reload
if [ "$WAS_ACTIVE" = "1" ]; then
  systemctl restart wyoming-satellite
fi
