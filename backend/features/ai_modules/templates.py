"""Scaffold files for a new AI-built module: the standard MagicMirror² shape
(modulename.js is the only file the core actually requires; node_helper.js,
css and package.json are convention, kept so the agent always starts from
the house structure instead of inventing one).

No demo.html, no README.md here — those are not generated.
"""

import json


def module_js(name: str, description: str = "") -> str:
    cls = "".join(c for c in name.lower() if c.isalnum())
    desc_js = json.dumps(description or name)
    return f"""/* {name}.js — frontend (Module.register). Scaffolded by the AI module builder. */
Module.register("{name}", {{
  defaults: {{
    updateInterval: 60 * 1000,
  }},

  getStyles() {{
    return ["{name}.css"];
  }},

  start() {{
    Log.info("[{name}] started");
    this.viewModel = null;
  }},

  socketNotificationReceived(notification, payload) {{
    // Data from node_helper.js arrives here. Call this.updateDom() to re-render.
  }},

  getDom() {{
    const wrap = document.createElement("div");
    wrap.className = "{cls}";
    wrap.textContent = {desc_js};
    return wrap;
  }},
}});
"""


def module_css(name: str) -> str:
    cls = "".join(c for c in name.lower() if c.isalnum())
    return f"""/* {name}.css — mirror style: light text on a dark/transparent background. */
.{cls} {{
  color: #fff;
  font-size: 18px;
  line-height: 1.3;
}}
"""


def node_helper_js(name: str) -> str:
    notif = name.upper().replace("-", "_")
    return f"""/* node_helper.js — backend (network calls, file IO, secrets). Delete if unused. */
const NodeHelper = require("node_helper");
const Log = require("logger");

module.exports = NodeHelper.create({{
  start() {{
    Log.info("[{name}] node_helper started");
  }},

  socketNotificationReceived(notification, payload) {{
    // Do background work here, then:
    // this.sendSocketNotification("{notif}_DATA", data);
  }},
}});
"""


def package_json(name: str, description: str = "") -> str:
    return json.dumps({
        "name": name.lower(),
        "version": "0.1.0",
        "description": description or f"MagicMirror module {name}",
        "main": f"{name}.js",
        "private": True,
        "dependencies": {},
    }, indent=2) + "\n"


def scaffold(name: str, description: str = "") -> dict:
    """The standard 4-file MagicMirror module, so the agent always starts
    from the house structure instead of inventing one."""
    return {
        f"{name}.js": module_js(name, description),
        f"{name}.css": module_css(name),
        "node_helper.js": node_helper_js(name),
        "package.json": package_json(name, description),
    }
