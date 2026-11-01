"""MQTT topics owned by the camera feature."""

RECOGNITION = "smartmirror/camera/recognition"   # out: {"user": name|null}
GESTURE = "smartmirror/camera/gesture"           # out: {"fingers": n}
RESET = "smartmirror/control/reset"              # in:  clear recognition state

# in: cross-feature presence signal ("present"/"absent"), owned by no single
# feature — published by features/distance today, any future presence
# source later. Mirrors the same string in features/distance/constants.py
# and features/display/constants.py (GLOBAL_PRESENCE) — see those for the
# full rationale. Drives idle/face/gesture directly inside this process now
# (previously a separate camera-recognition daemon subscribed to the
# radar-specific smartmirror/radar/presence instead).
PRESENCE = "smartmirror/global/presence"

MODE = "smartmirror/camera/mode"                 # out: current mode (retained)
STATE = "smartmirror/camera/state"               # out: health snapshot (retained)
PROFILES = "smartmirror/camera/profiles"         # out: profile list (retained)

# ---- RPC endpoints (request/reply — see MqttClient.serve) ---------------- #
# Everything the camera used to answer over HTTP except the two binary
# surfaces (/stream.mjpg, /photo), which stay HTTP by necessity.
RPC = "smartmirror/camera/rpc"
RPC_HEALTH = f"{RPC}/health"             # in: {} → health snapshot
RPC_MODE_GET = f"{RPC}/mode/get"         # in: {} → {"mode": …}
RPC_MODE_SET = f"{RPC}/mode/set"         # in: {"mode": …} → health — a manual
                                         # dev-tab choice; overrides the
                                         # idle/face/gesture presence machine
                                         # for a while (see mode_controller.py)
RPC_MODE_RENEW = f"{RPC}/mode/renew"     # in: {} → health — call while the
                                         # dev console stays open, so the
                                         # manual override above doesn't expire
RPC_MODE_RELEASE = f"{RPC}/mode/release" # in: {} → health — the dev console
                                         # closed; hand control back to presence
RPC_SETTINGS = f"{RPC}/settings"         # in: {width,height,framerate,
                                         #      recognition_tolerance,
                                         #      brightness,contrast,
                                         #      saturation,sharpness,auto_exposure,
                                         #      exposure_time_us,exposure_value,
                                         #      auto_white_balance,awb_mode,
                                         #      analogue_gain,noise_reduction}
                                         # (every key optional — only sent keys
                                         # change, all take effect live) → health
RPC_DATASET_LIST = f"{RPC}/dataset/list"      # in: {"name"} → {"photos": […]}
RPC_DATASET_DELETE = f"{RPC}/dataset/delete"  # in: {"name","file"} → {"photos"}
RPC_CAPTURE = f"{RPC}/capture"           # in: {"name","file"} → {"file","total"}
RPC_ENCODE = f"{RPC}/encode"             # in: {"name"|null} → {"ok","output"}
RPC_PROFILES_LIST = f"{RPC}/profiles/list"      # in: {} → {"profiles": […]}
RPC_PROFILES_DELETE = f"{RPC}/profiles/delete"  # in: {"name"} → {"removed",…}
