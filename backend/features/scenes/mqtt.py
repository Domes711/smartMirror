"""MQTT topics owned by the scenes feature."""

APPLIED = "smartmirror/scenes/applied"   # out: a new layout is live
PREVIEW = "smartmirror/profile/preview"  # out: live preview while editing
                                          #      (consumed by MagicMirror/js/profile.js)

# ---- RPC endpoints (request/reply — see MqttClient.serve) ---------------- #
RPC = "smartmirror/scenes/rpc"
RPC_LAYOUT_GET = f"{RPC}/layout/get"      # in: {} → the whole layout store
RPC_LAYOUT_PUT = f"{RPC}/layout/put"      # in: the store → {"ok"}
RPC_LAYOUT_APPLY = f"{RPC}/layout/apply"  # in: {} → {ok,restarted,reload_needed}
RPC_MODULES_GET = f"{RPC}/modules/get"    # in: {} → catalog + taken ids

# Hot-load a newly placed module into the running MagicMirror core. Replaces
# the HTTP POST /module/hot-load the scenes feature used to make; the core
# already has an MQTT client (js/profile.js), so this closes the last
# backend→core HTTP hop. The core answers on HOT_LOAD_RESULT.
HOT_LOAD = "smartmirror/core/hot-load"            # out: {moduleName,moduleId,moduleConfig}
HOT_LOAD_RESULT = "smartmirror/core/hot-load/result"  # in:  {moduleId, ok}
