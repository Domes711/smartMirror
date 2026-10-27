"""MQTT topics owned by the radar feature.

Nothing outside this feature constructs these strings — other features
import the constants.
"""

PRESENCE = "smartmirror/radar/presence"    # out: "present" | "absent"
TARGETS = "smartmirror/radar/targets"      # out: {targets, present, zone} ~10 Hz
CONTROL = "smartmirror/radar/control"      # in:  calibration commands
CONFIG = "smartmirror/radar/config"        # out: current config (retained)
STATUS = "smartmirror/radar/status"        # out: {active, available} (retained)
SERVICE_CONTROL = "smartmirror/radar/service"  # in: {"active": bool} start/stop

# RPC: the unit's own start/stop/status. Served by the camera supervisor —
# the radar daemon cannot start itself once stopped, and the supervisor is
# the process that already holds the systemctl sudoers rights.
RPC_SERVICE_GET = "smartmirror/radar/rpc/service/get"   # in: {} → {active,available}
RPC_SERVICE_SET = "smartmirror/radar/rpc/service/set"   # in: {"active"} → same

SERVICE_NAME = "radar"
