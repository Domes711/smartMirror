"""Reads values straight out of MagicMirror/config/config.js.

config.js is JS (`module.exports = {...}`), not JSON, so this does not parse
it generically — just pulls one string key out by regex, the same way the
AI module builder's system prompt always has.
"""

import re

from shared import paths


def language() -> str:
    """The mirror's configured language (default: cs)."""
    try:
        with open(paths.CONFIG_JS_PATH, encoding="utf-8") as f:
            m = re.search(r'\blanguage\s*:\s*["\']([^"\']+)["\']', f.read())
        return m.group(1) if m else "cs"
    except Exception:  # noqa: BLE001
        return "cs"
