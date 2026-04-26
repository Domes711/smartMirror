/* MMM-Profile
 *
 * Presence-driven profile + page scheduler. Receives events from the Pi
 * (via node_helper's HTTP route), maintains the (presence, user) state
 * machine, renders the Face ID-style indicator at top_center and remaps
 * every other module on the mirror to the active page's layout.
 *
 * State machine (per spec 2026-04-26-mmm-profile-design.md):
 *
 *   asleep
 *     ──presence_on──► scanning ──user_recognized(X)─► user (X)
 *                              ──user_unknown─────────► user (default)
 *   user
 *     ──presence_off─► dimming (60 s timer)
 *   dimming
 *     ──presence_on──► user (cancel timer, no re-recognize)
 *     ──timer expires─► asleep
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
        this.state = "asleep";          // asleep | scanning | user | dimming
        this.currentUser = null;
        this.dimTimer = null;
        this.activePageKey = null;

        this.sendSocketNotification("MMP_INIT", {});
    },

    getStyles: function () {
        return ["MMM-Profile.css"];
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification !== "MMP_EVENT" || !payload) return;
        switch (payload.event) {
            case "presence_on":     this._onPresenceOn();              break;
            case "presence_off":    this._onPresenceOff();             break;
            case "user_recognized": this._onUserRecognized(payload.user); break;
            case "user_unknown":    this._onUserUnknown();             break;
        }
    },

    // --- transitions --------------------------------------------------------

    _onPresenceOn: function () {
        if (this._cancelDimTimer()) {
            // Re-entry within the dim window: stay on the same user, no
            // re-recognition, no UI change.
            this.state = "user";
            this._render();
            return;
        }
        // Fresh wake-up.
        this.state = "scanning";
        this.currentUser = null;
        this._render();
    },

    _onUserRecognized: function (user) {
        if (!user) return this._onUserUnknown();
        this.state = "user";
        this.currentUser = user;
        this._render();
    },

    _onUserUnknown: function () {
        this.state = "user";
        this.currentUser = this.config.defaultUser;
        this._render();
    },

    _onPresenceOff: function () {
        if (this.state === "asleep") return;
        this.state = "dimming";
        this._cancelDimTimer();
        this.dimTimer = setTimeout(() => {
            this.dimTimer = null;
            this.state = "asleep";
            this.currentUser = null;
            this._render();
        }, this.config.dimTimeoutMs);
        // No visual change during dimming — UI stays as it was per spec.
    },

    _cancelDimTimer: function () {
        if (this.dimTimer) {
            clearTimeout(this.dimTimer);
            this.dimTimer = null;
            return true;
        }
        return false;
    },

    _render: function () {
        this.updateDom(250);
    },

    // --- DOM ---------------------------------------------------------------

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
        // asleep -> empty container (CSS hides it)

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
    }
});
