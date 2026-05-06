/* MMM-Profile
 *
 * Frontend half of the presence-driven profile + page scheduler. The DOM
 * shape and animation are mirrored from demo.html (this folder) so the
 * mirror produces the same Face ID look the demo shows. State logic
 * + cron-driven page resolution live in node_helper.js.
 *
 * Helper protocol:
 *   FE → BE   MMP_INIT { pages, defaultUser, dimTimeoutMs }
 *   BE → FE   MMP_STATE { state, currentUser, layout }
 *               state: "asleep" | "scanning" | "user" | "dimming"
 *
 * State → animation class on .profile:
 *   asleep    -> wrapper hidden via [data-state="asleep"]
 *   scanning  -> .profile (no class) — ring + face + sweep + dots
 *   user (X)  -> .profile.success — checkmark morph + avatar reveal + name
 *   user (def)-> .profile.error   — X cross
 *   dimming   -> keeps the previous .success / .error class
 */

Module.register("MMM-Profile", {
    defaults: {
        defaultUser: "default",
        scanningStatus: "Skenování obličeje…",
        recognizedStatus: "Obličej rozpoznán",
        unknownStatus: "Obličej nerozpoznán",
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

        this.updateDom(0);

        // Always project layout, even if key didn't change (modules need to show/hide)
        if (this.domReady) {
            this._project(this.activeLayout);
        }
        this.activeLayoutKey = this._layoutKey(this.activeLayout);
    },

    _layoutKey: function (layout) {
        return layout.map((e) => e.id + "@" + e.position).join("|");
    },

    // --- indicator UI -----------------------------------------------------

    getDom: function () {
        const wrap = document.createElement("div");
        wrap.className = "mmp";
        wrap.dataset.state = this.state;

        if (this.state === "asleep") return wrap;

        const profileClass = this._profileClass();
        const display = this._displayName();

        wrap.appendChild(this._buildProfile(profileClass, display));
        return wrap;
    },

    _profileClass: function () {
        if (this.state === "scanning") return "";
        if (this.state === "user" || this.state === "dimming") {
            return (this.currentUser
                && this.currentUser !== this.config.defaultUser) ? "success" : "error";
        }
        return "";
    },

    _displayName: function () {
        if (!this.currentUser || this.currentUser === this.config.defaultUser) return "";
        return this.config.userDisplayNames[this.currentUser] || this.currentUser;
    },

    _statusText: function () {
        if (this.state === "scanning") return this.config.scanningStatus;
        if (this.state === "user" || this.state === "dimming") {
            return (this.currentUser && this.currentUser !== this.config.defaultUser)
                ? this.config.recognizedStatus
                : this.config.unknownStatus;
        }
        return "";
    },

    _buildProfile: function (extraClass, displayName) {
        const profile = document.createElement("div");
        profile.className = "profile" + (extraClass ? " " + extraClass : "");

        const scanner = document.createElement("div");
        scanner.className = "scanner";
        if (this.state === "scanning") scanner.classList.add("intro");

        scanner.appendChild(this._buildRing());
        scanner.appendChild(el("div", "dots"));
        scanner.appendChild(el("div", "scan-line"));
        scanner.appendChild(this._buildFaceSvg());
        scanner.appendChild(this._buildAvatarSvg());

        profile.appendChild(scanner);
        profile.appendChild(this._buildProfileInfo(displayName));
        return profile;
    },

    _buildStatus: function (text) {
        const s = document.createElement("div");
        s.className = "mmp-status";
        s.textContent = text;
        return s;
    },

    _buildRing: function () {
        const NS = "http://www.w3.org/2000/svg";
        const ring = document.createElement("div");
        ring.className = "ring";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.setAttribute("aria-hidden", "true");
        const circle = document.createElementNS(NS, "circle");
        circle.setAttribute("class", "ring-circle");
        circle.setAttribute("cx", "50");
        circle.setAttribute("cy", "50");
        circle.setAttribute("r", "49");
        circle.setAttribute("pathLength", "60");
        circle.setAttribute("stroke-dasharray", "1 1");
        svg.appendChild(circle);
        ring.appendChild(svg);
        return ring;
    },

    _buildFaceSvg: function () {
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("class", "face");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.setAttribute("aria-hidden", "true");

        const outline = document.createElementNS(NS, "circle");
        outline.setAttribute("class", "outline");
        outline.setAttribute("cx", "50");
        outline.setAttribute("cy", "50");
        outline.setAttribute("r", "34");
        svg.appendChild(outline);

        svg.appendChild(this._svgPath("eye-l", "M38 42 v6"));
        svg.appendChild(this._svgPath("eye-r", "M62 42 v6"));
        svg.appendChild(this._svgPath("mouth", "M38 62 Q50 70 62 62"));
        svg.appendChild(this._svgPath("x-stroke x1", "M30 30 L70 70"));
        svg.appendChild(this._svgPath("x-stroke x2", "M70 30 L30 70"));
        return svg;
    },

    _svgPath: function (cls, d) {
        const NS = "http://www.w3.org/2000/svg";
        const p = document.createElementNS(NS, "path");
        p.setAttribute("class", cls);
        p.setAttribute("d", d);
        return p;
    },

    _buildAvatarSvg: function () {
        const NS = "http://www.w3.org/2000/svg";
        const wrap = document.createElement("div");
        wrap.className = "avatar";
        wrap.setAttribute("aria-hidden", "true");
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 100 100");
        const head = document.createElementNS(NS, "circle");
        head.setAttribute("cx", "50");
        head.setAttribute("cy", "38");
        head.setAttribute("r", "18");
        svg.appendChild(head);
        const body = document.createElementNS(NS, "path");
        body.setAttribute("d", "M14 96 C14 70 30 60 50 60 C70 60 86 70 86 96 Z");
        svg.appendChild(body);
        wrap.appendChild(svg);
        return wrap;
    },

    _buildProfileInfo: function (name) {
        const info = document.createElement("div");
        info.className = "profile-info";
        const nameEl = document.createElement("div");
        nameEl.className = "name";
        nameEl.textContent = name || "";
        info.appendChild(nameEl);
        return info;
    },

    // --- DOM remap of other modules ---------------------------------------

    _project: function (layout) {
        const wantedById = new Map();
        for (const entry of layout) {
            if (!entry || !entry.id || !entry.position) continue;
            wantedById.set(entry.id, entry.position);
        }

        const mods = MM.getModules().enumerate(() => true);
        for (const mod of mods) {
            if (mod.name === "MMM-Profile") continue;
            const id = mod.data && mod.data.id;
            if (!id) continue;
            const pos = wantedById.get(id);
            const elNode = document.getElementById(mod.identifier);
            if (!elNode) continue;
            if (pos) {
                const region = document.querySelector(
                    ".region." + pos.replace(/_/g, "."));
                if (region && elNode.parentElement !== region) {
                    region.appendChild(elNode);
                }
                mod.show(0, () => {}, { lockString: "mmm-profile" });
            } else {
                mod.hide(0, () => {}, { lockString: "mmm-profile" });
            }
        }
    }
});

function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
}
