"""MQTT topics owned by the radar feature.

Nothing outside this feature constructs these strings — other features
import the constants.
"""

PRESENCE = "smartmirror/radar/presence"    # out: "present" | "absent"
# out: {targets, present, zone} ~10 Hz — only while a client has sent
# CONTROL {"cmd": "stream", "active": true} (renew every <6s; "active":
# false or 6s of silence auto-stops it). Otherwise silent — the dev console
# map is the only consumer, and nobody polling for ghosts shouldn't cost
# ~600 messages/minute. Use PRESENCE/CONFIG for anything that needs to run
# unconditionally in the background.
TARGETS = "smartmirror/radar/targets"
CONTROL = "smartmirror/radar/control"      # in:  calibration + stream commands
CONFIG = "smartmirror/radar/config"        # out: current config (retained)
STATUS = "smartmirror/radar/status"        # out: {active, available} (retained)
SERVICE_CONTROL = "smartmirror/radar/service"  # in: {"active": bool} start/stop

# RPC: the unit's own start/stop/status. Served by the camera supervisor —
# the radar daemon cannot start itself once stopped, and the supervisor is
# the process that already holds the systemctl sudoers rights.
RPC_SERVICE_GET = "smartmirror/radar/rpc/service/get"   # in: {} → {active,available}
RPC_SERVICE_SET = "smartmirror/radar/rpc/service/set"   # in: {"active"} → same

SERVICE_NAME = "radar"
