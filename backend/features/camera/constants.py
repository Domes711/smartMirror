"""MQTT topics owned by the camera feature."""

RECOGNITION = "smartmirror/camera/recognition"   # out: {"user": name|null}
GESTURE = "smartmirror/camera/gesture"           # out: {"fingers": n}
RESET = "smartmirror/control/reset"              # in:  clear recognition state
PRESENCE = "smartmirror/radar/presence"          # in:  from the radar feature

MODE = "smartmirror/camera/mode"                 # out: current mode (retained)
STATE = "smartmirror/camera/state"               # out: health snapshot (retained)
PROFILES = "smartmirror/camera/profiles"         # out: profile list (retained)

# ---- RPC endpoints (request/reply — see MqttClient.serve) ---------------- #
# Everything the camera used to answer over HTTP except the two binary
# surfaces (/stream.mjpg, /photo), which stay HTTP by necessity.
RPC = "smartmirror/camera/rpc"
RPC_HEALTH = f"{RPC}/health"             # in: {} → health snapshot
RPC_MODE_GET = f"{RPC}/mode/get"         # in: {} → {"mode": …}
RPC_MODE_SET = f"{RPC}/mode/set"         # in: {"mode": …} → health
RPC_RESOLUTION = f"{RPC}/resolution"     # in: {"width","height"} → health
RPC_DATASET_LIST = f"{RPC}/dataset/list"      # in: {"name"} → {"photos": […]}
RPC_DATASET_DELETE = f"{RPC}/dataset/delete"  # in: {"name","file"} → {"photos"}
RPC_CAPTURE = f"{RPC}/capture"           # in: {"name","file"} → {"file","total"}
RPC_ENCODE = f"{RPC}/encode"             # in: {"name"|null} → {"ok","output"}
RPC_PROFILES_LIST = f"{RPC}/profiles/list"      # in: {} → {"profiles": […]}
RPC_PROFILES_DELETE = f"{RPC}/profiles/delete"  # in: {"name"} → {"removed",…}

# The unit that owns the camera for production face recognition. The
# supervisor stops it before taking the device for a test/learn stream.
RECOGNITION_SERVICE = "camera-recognition"
