# Module Store — design

**Status:** implemented (branch `claude/module-store`)
**Date:** 2026-06-05

## Goal

Add a **Module Store** card to the console's user section (next to *Profily*) that
lets the user browse all available MagicMirror modules, see an app-store style
detail (image gallery + README), and **install / uninstall** a module with a
single tap — clone, deps, register in config, restart the mirror.

## Source of data

- **Community catalog:** `https://modules.magicmirror.builders/data/modules.json`
  — JSON of the form `{"modules": [ … ]}`, ~1400 entries. Each entry has
  `id` (`owner/repo`), `name`, `url`, `description`, `category`, `maintainer`,
  `stars`, `image` (filename). Fetched **server-side** by the supervisor (avoids
  CORS; the Pi has internet) and cached for 30 min.
- **Images:** `https://modules.magicmirror.builders/images/<image>` (WebP).
- **README:** community → GitHub/GitLab raw (`…/HEAD|master|main/README.md`,
  first that returns 200); own modules → local `README.md`. The detail view
  also harvests image URLs from the README for the gallery (badges filtered out).

## Two lists (auto split, no manual maintenance)

- **Z internetu** — the full community catalog, each entry flagged `installed`
  when a same-named dir exists under `MagicMirror/modules/`.
- **Moje moduly** — local `MMM-*` module dirs **not** present in the community
  catalog (i.e. our own modules; forks that exist upstream show up as
  *installed* community entries instead). Auto-detected from disk.

## Install (chosen behaviour: bare registration)

`POST /store/install {id}` → validated against the **trusted cached catalog**
(URL is never taken from the client; dir name must match `^MMM-[\w.-]+$`;
source must be github/gitlab https), then runs on a background thread:

1. `git clone --depth 1 <url>` → `modules/<name>`
2. `npm install --omit=dev` if the module has a `package.json`
3. record in `installed_modules.json` (per-Pi, gitignored) so it merges into the
   **effective catalog**; add a bare instance (`{id, type:name, values:{}}`) and
   a `globalLayout` slot at `top_center` to the layout store
4. `generate_files()` (pages.js + inject into config.js) + `pm2 restart MagicMirror`

Progress is **phase-based** (`cloning 10→40`, `npm 50`, `config 88`,
`restarting 94`, `done 100`) exposed at `GET /store/install/status?id=` and
polled ~1×/s by the install button, which renders the live %.

Configuration and final placement happen afterwards in the existing
**Profily → Rozložení** editor — consistent with the current architecture
(installed modules now appear in that editor's module picker via the effective
catalog).

## Uninstall

`POST /store/uninstall {name}` → `rm -rf modules/<name>`, drop the catalog entry
from `installed_modules.json`, remove the module's instances + every
`globalLayout`/`windows[*].layout` reference from the store, `generate_files()`,
`pm2 restart`.

## Security note

Installing a community module runs arbitrary npm postinstall code on the Pi —
inherent to MagicMirror modules. Per the user's choice the card sits in the
(non-PIN) user section; the install URL is constrained to catalog entries from
github/gitlab over https, and the directory name is regex-validated to prevent
path traversal.

## Files

- Backend: `mirror-console/backend/supervisor.py` — effective catalog
  (`load_installed_modules` / `effective_catalog` / `catalog_by_type`), store
  fetch + `store_catalog` / `store_readme`, `install_module` / `_install_worker`
  / `install_status` / `uninstall_module`, routes `/store/*`.
- Proxy: `mirror-console/server/index.js` — `/store` added to the pathFilter.
- Frontend: `web/src/ModuleStorePanel.jsx`, `ModuleDetail.jsx`, `Markdown.jsx`,
  tab wired in `App.jsx`, styles in `App.css`.
- `.gitignore`: `mirror-console/backend/installed_modules.json` (per-Pi state).
