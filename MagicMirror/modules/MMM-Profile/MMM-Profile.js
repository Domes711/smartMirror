/* MMM-Profile
 *
 * Frontend half of the presence-driven profile + page scheduler.
 * State machine and cron-driven page resolution live in node_helper.js
 * (cron-parser is a Node module). This file:
 *
 *   - Sends pages config to the helper on start (MMP_INIT)
 *   - Receives MMP_STATE { state, currentUser, layout } and:
 *       - re-renders the indicator (Face ID dots / avatar / "?" badge)
 *       - reparents every other module's DOM wrapper into the region
 *         declared by the layout, hides those not in the layout
 *
 * State semantics (from the spec):
 *   asleep   – all managed modules hidden, indicator hidden
 *   scanning – default user's current-window layout, Face ID animation
 *   user     – user's current-window layout, avatar + name
 *   dimming  – visually identical to user; we're just waiting to see if
 *              presence comes back within dimTimeoutMs
 */

Module.register("MMM-Profile", {
    defaults: {
        defaultUser: "default",
        unknownLabel: "Unknown",
        scanningLabel: "scanning",
        userDisplayNames: {},
        dimTimeoutMs: 60 * 1000,
        pages: null
    },

    start: function () {
        this.state = "asleep";
        this.currentUser = null;
        this.activeLayout = [];
        this.activeLayoutKey = null;
        this.domReady = false;

        this.sendSocketNotification("MMP_INIT", {
            pages: this.config.pages,
            defaultUser: this.config.defaultUser,
            dimTimeoutMs: this.config.dimTimeoutMs
        });
    },

    getStyles: function () {
        return ["MMM-Profile.css"];
    },

    notificationReceived: function (notification) {
        if (notification === "DOM_OBJECTS_CREATED") {
            this.domReady = true;
            this._project(this.activeLayout);
        }
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification !== "MMP_STATE" || !payload) return;
        this.state = payload.state || "asleep";
        this.currentUser = payload.currentUser || null;
        this.activeLayout = Array.isArray(payload.layout) ? payload.layout : [];

        this.updateDom(250);

        const key = this._layoutKey(this.activeLayout);
        if (key !== this.activeLayoutKey) {
            this.activeLayoutKey = key;
            if (this.domReady) this._project(this.activeLayout);
        }
    },

    _layoutKey: function (layout) {
        // Stable string for diffing; order matters because positions could
        // shift even with the same set of ids.
        return layout.map((e) => e.id + "@" + e.position).join("|");
    },

    // --- indicator UI -----------------------------------------------------

    getDom: function () {
        const wrap = document.createElement("div");
        wrap.className = "mmp";
        wrap.dataset.state = this.state;

        if (this.state === "scanning") {
            wrap.appendChild(this._buildScanning());
        } else if (this.state === "user" || this.state === "dimming") {
            const user = this.currentUser || this.config.defaultUser;
            if (user === this.config.defaultUser) {
                wrap.appendChild(this._buildBadge("?", this.config.unknownLabel));
                wrap.dataset.state = "unknown";
            } else {
                const letter = user.charAt(0).toUpperCase();
                const display = this.config.userDisplayNames[user] || user;
                wrap.appendChild(this._buildBadge(letter, display));
            }
        }
        // asleep: empty wrapper (CSS hides it)
        return wrap;
    },

    _buildScanning: function () {
        const wrap = document.createElement("div");
        wrap.className = "mmp-scan";

        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "-60 -60 120 120");
        svg.setAttribute("class", "mmp-scan-svg");

        const DOTS = 24;
        const RADIUS = 48;
        for (let i = 0; i < DOTS; i++) {
            const angle = (i / DOTS) * Math.PI * 2;
            const dot = document.createElementNS(NS, "circle");
            dot.setAttribute("cx", Math.cos(angle) * RADIUS);
            dot.setAttribute("cy", Math.sin(angle) * RADIUS);
            dot.setAttribute("r", 2.5);
            dot.setAttribute("class", "mmp-dot");
            dot.style.animationDelay = ((i / DOTS) * 1.5).toFixed(3) + "s";
            svg.appendChild(dot);
        }
        wrap.appendChild(svg);

        const label = document.createElement("div");
        label.className = "mmp-label";
        label.textContent = this.config.scanningLabel;
        wrap.appendChild(label);

        return wrap;
    },

    _buildBadge: function (letter, name) {
        const wrap = document.createElement("div");
        wrap.className = "mmp-badge";

        const avatar = document.createElement("div");
        avatar.className = "mmp-avatar";
        avatar.textContent = letter;
        wrap.appendChild(avatar);

        const text = document.createElement("div");
        text.className = "mmp-name";
        text.textContent = name;
        wrap.appendChild(text);

        return wrap;
    },

    // --- DOM remap of other modules ---------------------------------------

    /**
     * Move every module's DOM wrapper to the region declared in `layout`,
     * show it; hide everything else. We carry a `lockString` so other
     * modules' show/hide notifications can't fight us.
     */
    _project: function (layout) {
        const wantedById = new Map();
        for (const entry of layout) {
            if (!entry || !entry.id || !entry.position) continue;
            wantedById.set(entry.id, entry.position);
        }

        const mods = MM.getModules().enumerate(() => true);
        for (const mod of mods) {
            if (mod.name === "MMM-Profile") continue;
            const id = (mod.data && mod.data.id) || mod.name;
            const pos = wantedById.get(id);
            const el = document.getElementById(mod.identifier);
            if (!el) continue;
            if (pos) {
                const region = document.querySelector(
                    ".region." + pos.replace(/_/g, "."));
                if (region && el.parentElement !== region) {
                    region.appendChild(el);
                }
                mod.show(0, () => {}, { lockString: "mmm-profile" });
            } else {
                mod.hide(0, () => {}, { lockString: "mmm-profile" });
            }
        }
    }
});
