/* MMM-FaceRecoIndicator
 *
 * Monochrome face-recognition indicator shown at top_center. Three states
 * driven by notifications from MMM-Face-Reco-DNN:
 *
 *   scanning   -> Face ID-like animated dot ring
 *   recognized -> round badge with the user's initial + display name
 *   unknown    -> round badge with "?" + "Unknown"
 */

Module.register("MMM-FaceRecoIndicator", {
    defaults: {
        unknownLabel: "Unknown",
        scanningLabel: "scanning",
        // Override what is shown next to the avatar per username.
        // Default is the username itself.
        userDisplayNames: {}
    },

    start: function () {
        this.state = "scanning";
        this.currentUser = null;
    },

    notificationReceived: function (notification, payload) {
        if (notification === "CURRENT_USER") {
            const user = typeof payload === "string"
                ? payload
                : (payload && payload.username) || null;
            if (!user || user === "unknown") {
                this.state = "unknown";
                this.currentUser = null;
            } else {
                this.state = "recognized";
                this.currentUser = user;
            }
            this.updateDom(300);
        } else if (notification === "EVERYBODY_LEAVES") {
            this.state = "scanning";
            this.currentUser = null;
            this.updateDom(300);
        }
    },

    getDom: function () {
        const wrapper = document.createElement("div");
        wrapper.className = "mmfr";
        wrapper.dataset.state = this.state;

        if (this.state === "scanning") {
            wrapper.appendChild(this._buildScanning());
        } else if (this.state === "recognized") {
            const letter = (this.currentUser || "?").charAt(0).toUpperCase();
            const name = this.config.userDisplayNames[this.currentUser]
                || this.currentUser;
            wrapper.appendChild(this._buildBadge(letter, name));
        } else {
            wrapper.appendChild(this._buildBadge("?", this.config.unknownLabel));
        }

        return wrapper;
    },

    _buildScanning: function () {
        const wrap = document.createElement("div");
        wrap.className = "mmfr-scan";

        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "-60 -60 120 120");
        svg.setAttribute("class", "mmfr-scan-svg");

        const DOTS = 24;
        const RADIUS = 48;
        for (let i = 0; i < DOTS; i++) {
            const angle = (i / DOTS) * Math.PI * 2;
            const dot = document.createElementNS(NS, "circle");
            dot.setAttribute("cx", Math.cos(angle) * RADIUS);
            dot.setAttribute("cy", Math.sin(angle) * RADIUS);
            dot.setAttribute("r", 2.5);
            dot.setAttribute("class", "mmfr-dot");
            dot.style.animationDelay = ((i / DOTS) * 1.5).toFixed(3) + "s";
            svg.appendChild(dot);
        }
        wrap.appendChild(svg);

        const label = document.createElement("div");
        label.className = "mmfr-label";
        label.textContent = this.config.scanningLabel;
        wrap.appendChild(label);

        return wrap;
    },

    _buildBadge: function (letter, name) {
        const wrap = document.createElement("div");
        wrap.className = "mmfr-badge";

        const avatar = document.createElement("div");
        avatar.className = "mmfr-avatar";
        avatar.textContent = letter;
        wrap.appendChild(avatar);

        const text = document.createElement("div");
        text.className = "mmfr-name";
        text.textContent = name;
        wrap.appendChild(text);

        return wrap;
    },

    getStyles: function () {
        return ["MMM-FaceRecoIndicator.css"];
    }
});
