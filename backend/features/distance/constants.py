"""All constants for the distance feature: MQTT topics and GPIO pins.

HC-SR04 ultrasonic distance sensor — a trigger pulse on TRIG starts a ping,
and the ECHO pin stays high for the round-trip time of the reflection. No
UART, no library: this is plain GPIO bit-banging, measured directly in the
daemon's read loop.
"""

BASE = "smartmirror/distance"

# out: {cm, available, near} once per averaging window — ONLY while a client
# holds a live-stream lease (CONTROL {"cmd": "stream", "active": true},
# renewed every <STREAM_TIMEOUT_S; "active": false or silence stops it).
# The dev console is the only consumer; presence (GLOBAL_PRESENCE) is
# published regardless, so the mirror never depends on this topic.
READING = f"{BASE}/reading"
STATUS = f"{BASE}/status"     # out: {active, available} (retained)
# in: {"active": bool} enable/disable sampling, or
#     {"cmd": "stream", "active": bool} open/renew/close the READING stream
CONTROL = f"{BASE}/control"

# Live READING stream auto-stops this long after the last renewal — the
# backstop for a client that vanished without sending "active": false
# (app killed, phone lost Wi-Fi). The app renews every 2s.
STREAM_TIMEOUT_S = 6

# Cross-feature presence signal — not distance's own topic. Any presence
# source publishes here ("present"/"absent", plain string like radar's old
# PRESENCE); any feature that cares whether someone is in the room (display
# today, more later) subscribes here instead of to one sensor's topic. Owned
# by no single feature; each publisher/subscriber keeps its own copy of the
# string, same as PROFILE_CHANGED in features/display/constants.py.
GLOBAL_PRESENCE = "smartmirror/global/presence"

# RPC: calibration config, same shape as radar/mic's config.get/config.set.
RPC = f"{BASE}/rpc"
RPC_CONFIG_GET = f"{RPC}/config/get"   # in: {} → {warn_cm, max_range_cm, avg_window_ms, absent_after_n}
RPC_CONFIG_SET = f"{RPC}/config/set"   # in: {<key>: <value>, …} → same shape

# GPIO (BCM numbering): board pin 16 = GPIO23, board pin 18 = GPIO24.
GPIO_TRIG = 23
GPIO_ECHO = 24

SPEED_OF_SOUND_CM_PER_S = 34300  # at ~20°C; /2 for round trip in the formula
ECHO_TIMEOUT_S = 0.03            # ~515 cm of round trip — well past max range
SAMPLE_INTERVAL_S = 0.2          # ~5 Hz; HC-SR04 needs >=60ms between pings
