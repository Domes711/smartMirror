"""All constants for the ai_modules feature: MQTT topics plus the one fixed
filename every working copy carries. No logic — just names and values.
"""

BASE = "smartmirror/ai_modules"

# Flat topics, no extra "rpc"-style segment — the feature prefix already
# says who owns them.
STATUS = f"{BASE}/status"                 # in: {} -> {claudeCli, model}
LIST = f"{BASE}/list"                     # in: {} -> {drafts: [...]}
DRAFT_CREATE = f"{BASE}/draft/create"     # in: {"name","description"} -> {ok, name, sessionId}
EDIT_OPEN = f"{BASE}/edit/open"           # in: {"name"} -> {ok, name, sessionId}
MESSAGE = f"{BASE}/message"               # in: {"name","scope","message"} -> {ok}
SESSION = f"{BASE}/session"               # in: {"name","scope"} -> session state
INSTALL = f"{BASE}/install"               # in: {"name","scope","overwrite"} -> {ok, installedTo}

# Setup chat: configure a new instance of an already-installed module by
# talking to the agent instead of filling a form. Not a draft — nothing is
# written to disk; the agent only reads the module and proposes config
# values, streamed back as a {"type":"config"} event on
# stream_topic(CONFIG_SCOPE, chatId).
CONFIG_START = f"{BASE}/config/start"     # in: {"chatId","module":{type,module,label,fields}} -> {ok}
CONFIG_MESSAGE = f"{BASE}/config/message" # in: {"chatId","message"} -> {ok}
CONFIG_END = f"{BASE}/config/end"         # in: {"chatId"} -> {ok}
CONFIG_SCOPE = "config"

# The agent's live token stream. One topic per session; payloads are the
# event objects the SSE stream used to carry ({type:"text"|"tool"|...}).
#   smartmirror/ai_modules/stream/<scope>/<name>
STREAM = f"{BASE}/stream"
STREAM_WILDCARD = f"{STREAM}/#"


def stream_topic(scope: str, name: str) -> str:
    """Per-session agent event topic."""
    return f"{STREAM}/{scope}/{name}"


SERVICE_NAME = "ai-modules"
