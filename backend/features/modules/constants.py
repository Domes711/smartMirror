"""All constants for the modules feature (the module store): MQTT topics and
the one fixed value `catalog.py` hardcodes. No logic — just names and values.

The AI module builder has its own topics now, under
features/ai_modules/constants.py.
"""

# Dirs under MagicMirror/modules/ that are not third-party modules.
NON_MODULE_DIRS = {"default", "node_modules", ".git"}

# --------------------------------------------------------------------------- #
# MQTT topics
# --------------------------------------------------------------------------- #
INSTALL_STARTED = "smartmirror/modules/install/started"
INSTALLED = "smartmirror/modules/install/done"
INSTALL_FAILED = "smartmirror/modules/install/failed"
UNINSTALLED = "smartmirror/modules/uninstalled"

# Install progress, pushed as it changes instead of polled. Retained per
# module type so a reconnecting app sees the current phase immediately.
INSTALL_PROGRESS = "smartmirror/modules/install/progress"   # out: {type,phase,percent,…}

# ---- store RPC ----------------------------------------------------------- #
RPC = "smartmirror/modules/rpc"
RPC_CATALOG = f"{RPC}/catalog"              # in: {} → {community, own, error}
RPC_README = f"{RPC}/readme"                # in: {"id","url"} → {markdown,baseUrl}
RPC_INSTALL = f"{RPC}/install"              # in: {"id"} → {ok,started,name}
RPC_INSTALL_STATUS = f"{RPC}/install/status"  # in: {"id"} → {phase,percent,done,…}
RPC_UNINSTALL = f"{RPC}/uninstall"          # in: {"name"} → {ok,removed}

SERVICE_NAME = "modules"
