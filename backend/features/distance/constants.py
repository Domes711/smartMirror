"""All constants for the distance feature: MQTT topics and GPIO pins.

HC-SR04 ultrasonic distance sensor — a trigger pulse on TRIG starts a ping,
and the ECHO pin stays high for the round-trip time of the reflection. No
UART, no library: this is plain GPIO bit-banging, measured directly in the
daemon's read loop.
"""

BASE = "smartmirror/distance"

READING = f"{BASE}/reading"   # out: {cm, available} ~5 Hz
STATUS = f"{BASE}/status"     # out: {active, available} (retained)
CONTROL = f"{BASE}/control"   # in:  {"active": bool} enable/disable sampling

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
