"""All constants for the mic feature: MQTT topics and the two systemd units
it arbitrates. No logic — just names and values.

The microphone is a Wyoming satellite (rhasspy/wyoming-satellite +
rhasspy/wyoming-openwakeword) streaming to Home Assistant's Assist pipeline —
this feature does not implement wake-word or voice assistant logic itself,
it only configures the satellite and arbitrates the USB mic hardware for test
recordings (same shape as the camera's exclusive-hardware arbitration).
"""

BASE = "smartmirror/mic"

# ---- RPC ------------------------------------------------------------------ #
RPC = f"{BASE}/rpc"
RPC_CONFIG_GET = f"{RPC}/config/get"      # in: {} → {device, satellite_name, wake_word, input_gain}
RPC_CONFIG_SET = f"{RPC}/config/set"      # in: {<key>: <value>, …} → same shape
RPC_TEST_RECORD = f"{RPC}/test_record"    # in: {"seconds"} → {ok, id, seconds}
RPC_SERVICE_GET = f"{RPC}/service/get"    # in: {} → {active, available}
RPC_SERVICE_SET = f"{RPC}/service/set"    # in: {"active"} → same

# The two systemd units this feature starts/stops to free the USB mic for a
# test recording, then restarts. wyoming-satellite depends on
# wyoming-openwakeword (Requires=), so stopping/starting the satellite alone
# is enough — the wake-word service can stay up, it holds no mic handle.
SERVICE_NAME = "wyoming-satellite"
WAKE_WORD_SERVICE_NAME = "wyoming-openwakeword"

# ALSA mixer control the input_gain config key maps onto. `amixer` names vary
# by card, but 'Mic' is the common USB-mic capture control.
ALSA_MIC_CONTROL = "Mic"
