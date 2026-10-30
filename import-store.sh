#!/usr/bin/env bash
# import-store.sh — ONE-TIME import of the community module catalog from the
# MMM-store repo (github.com/Domes711/MMM-store) into SQLite: module_catalog,
# module_fields (the wizard config fields), module_tags, module_screenshots.
#
# Not part of setup.sh / deploy.sh — run it once on a fresh DB, or again only
# when MMM-store itself has changed. Safe to re-run: own (custom/ai) modules
# are never touched and installed ones stay installed.
#
# Usage:  ./import-store.sh                      # clone/pull + import
#         ./import-store.sh --src ~/MMM-store    # use an existing checkout
#         ./import-store.sh --no-upstream        # skip modules.magicmirror.builders
#         ./import-store.sh --keep-stale         # don't drop removed modules
set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"

# MMM-store is private: clone it the same way this repo was cloned. An SSH
# origin here (git@github.com:…) means the Pi has a GitHub SSH key, so use it
# for MMM-store too. MMM_STORE_REPO overrides.
if [ -z "${MMM_STORE_REPO:-}" ] && \
   git -C "$REPO" remote get-url origin 2>/dev/null | grep -q '^git@github.com:'; then
  export MMM_STORE_REPO="git@github.com:Domes711/MMM-store.git"
fi

printf '\033[1;36m▸ Importing the module store (MMM-store)…\033[0m\n'
cd "$REPO/backend"
"$PY" -m features.modules.store_import "$@"
printf '\033[1;32m  ✓ Done — the store screen reads the new catalog right away.\033[0m\n'
