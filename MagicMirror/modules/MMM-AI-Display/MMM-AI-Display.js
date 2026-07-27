/* MMM-AI-Display
 *
 * The answer panel. Gemini (via Home Assistant) publishes a payload
 * {title, html, text, ttl} on `mirror/display/set`; node_helper forwards it
 * and the panel slides in from the top, shows the content, and slides back up
 * after `ttl` seconds. `mirror/display/clear` hides it immediately.
 *
 * KEY CONTRACT: Gemini supplies semantics + numbers only — never colour, font,
 * size or position. All styling lives in this module's CSS (the `aid-*` design
 * system). The HTML is run through a strict sanitizer before it ever touches
 * innerHTML: a whitelist of tags/attributes, `class` reduced to `aid-*` tokens,
 * and `style` reduced to `--name: number` custom properties only.
 *
 * Reference behaviour: assist-panel.html (design prototype).
 */

/* eslint-disable no-undef */

const AID_TAGS = [
    "div", "span", "b", "p", "ul", "li",
    "table", "thead", "tbody", "tr", "th", "td",
    "img", "svg", "polyline", "polygon", "circle", "g", "text"
];
const AID_ATTRS = [
    "class", "style", "src", "alt", "viewBox", "preserveAspectRatio",
    "points", "pathLength", "x", "y", "cx", "cy", "r", "colspan"
];
// Only `--name: number[%]` declarations survive — no colour/position/etc.
const AID_STYLE_DECL = /^\s*--[a-z0-9-]+\s*:\s*-?\d+(\.\d+)?%?\s*$/i;
const AID_SVG_NS = "http://www.w3.org/2000/svg";

Module.register("MMM-AI-Display", {
    defaults: {
        mqttBroker: "mqtt://127.0.0.1:1883",
        setTopic: "mirror/display/set",
        clearTopic: "mirror/display/clear",
        availabilityTopic: "mirror/display/availability",
        defaultTitle: "ASISTENT",
        defaultTtl: 60,
        maxTtl: 900,
        imgAllowlist: ["mirror.local"], // allowed `src` prefixes for aid-img
        shadow: true,
        language: "cs"
    },

    getStyles: function () {
        return ["MMM-AI-Display.css"];
    },

    start: function () {
        this._open = false;
        this._ttlTimer = null;
        this._swapTimer = null;
        this._clockTimer = null;

        this.sendSocketNotification("AID_INIT", {
            mqttBroker: this.config.mqttBroker,
            setTopic: this.config.setTopic,
            clearTopic: this.config.clearTopic,
            availabilityTopic: this.config.availabilityTopic
        });
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "AID_SET") {
            this._present(payload || {});
        } else if (notification === "AID_CLEAR") {
            this._hide();
        }
    },

    suspend: function () {
        // Stop the clock ticker and hide, so nothing runs behind a dark screen.
        this._clearTimers();
        this._hide();
    },

    resume: function () {
        if (this._holder && !this._clockTimer) {
            this._startClock();
        }
    },

    getDom: function () {
        // Build the panel once and keep returning the same node — visibility is
        // driven by class toggles, never updateDom() (which would jump-cut it).
        if (!this._holder) {
            this._holder = document.createElement("div");
            this._holder.className = "aid-holder" + (this.config.shadow ? " shadow-on" : "");

            const panel = document.createElement("div");
            panel.className = "aid";

            const head = document.createElement("div");
            head.className = "aid-head";
            this._titleEl = document.createElement("span");
            this._titleEl.className = "aid-title";
            this._titleEl.textContent = this.config.defaultTitle;
            this._clockEl = document.createElement("span");
            this._clockEl.className = "aid-clock";
            head.appendChild(this._titleEl);
            head.appendChild(this._clockEl);

            this._bodyEl = document.createElement("div");
            this._bodyEl.className = "aid-body";

            panel.appendChild(head);
            panel.appendChild(this._bodyEl);
            this._holder.appendChild(panel);

            this._updateClock();
            this._startClock();
        }
        return this._holder;
    },

    // --- presentation ------------------------------------------------------

    _present: function (payload) {
        const title = (payload.title && String(payload.title)) || this.config.defaultTitle;
        const frag = this._sanitize(payload.html || "");

        // Fallback: if nothing survived the contract, show `text` as a note.
        if (!frag.childNodes.length) {
            const text = payload.text != null ? String(payload.text) : "";
            if (text.trim()) {
                const note = document.createElement("div");
                note.className = "aid-note";
                note.textContent = text;
                frag.appendChild(note);
            }
        }
        // Nothing to show at all — treat like a clear.
        if (!frag.childNodes.length) {
            this._hide();
            return;
        }

        let ttl = parseInt(payload.ttl, 10);
        if (!Number.isFinite(ttl)) ttl = this.config.defaultTtl;
        ttl = Math.max(5, Math.min(this.config.maxTtl, ttl));

        const render = () => {
            this._titleEl.textContent = title;
            this._bodyEl.innerHTML = "";
            this._bodyEl.appendChild(frag);
            this._updateClock();
            this._show();
            this._armTtl(ttl);
        };

        // Content swap always goes through a close first — rewriting under an
        // open panel is a height jump that looks broken.
        if (this._open) {
            this._hide();
            clearTimeout(this._swapTimer);
            this._swapTimer = setTimeout(render, 360);
        } else {
            render();
        }
    },

    _show: function () {
        this._open = true;
        if (this._holder) this._holder.classList.add("is-open");
    },

    _hide: function () {
        this._open = false;
        if (this._holder) this._holder.classList.remove("is-open");
        if (this._ttlTimer) { clearTimeout(this._ttlTimer); this._ttlTimer = null; }
    },

    _armTtl: function (ttlSec) {
        if (this._ttlTimer) clearTimeout(this._ttlTimer);
        this._ttlTimer = setTimeout(() => {
            this._ttlTimer = null;
            this._hide();
        }, ttlSec * 1000);
    },

    _clearTimers: function () {
        if (this._ttlTimer) { clearTimeout(this._ttlTimer); this._ttlTimer = null; }
        if (this._swapTimer) { clearTimeout(this._swapTimer); this._swapTimer = null; }
        if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null; }
    },

    // --- clock -------------------------------------------------------------

    _startClock: function () {
        this._clockTimer = setInterval(() => this._updateClock(), 20000);
    },

    _updateClock: function () {
        if (!this._clockEl) return;
        const locale = this.config.language === "cs" ? "cs-CZ" : "en-GB";
        this._clockEl.textContent = new Intl.DateTimeFormat(locale, {
            hour: "2-digit", minute: "2-digit"
        }).format(new Date());
    },

    // --- sanitizer ---------------------------------------------------------

    /**
     * Turn untrusted Gemini HTML into a DocumentFragment of whitelisted nodes.
     * Everything not explicitly allowed is dropped. Returns an empty fragment
     * if nothing survives.
     */
    _sanitize: function (rawHtml) {
        const frag = document.createDocumentFragment();
        let html = String(rawHtml || "");

        // Strip a ```html … ``` markdown fence — Gemini sometimes wraps output.
        html = html.trim()
            .replace(/^```[a-z]*\s*\n?/i, "")
            .replace(/\n?```\s*$/i, "")
            .trim();
        if (!html) return frag;

        const doc = new DOMParser().parseFromString(html, "text/html");
        const src = doc.body;
        if (!src) return frag;

        for (const child of Array.from(src.childNodes)) {
            const clean = this._cleanNode(child);
            if (clean) frag.appendChild(clean);
        }
        return frag;
    },

    _cleanNode: function (node) {
        // Text node — keep verbatim.
        if (node.nodeType === 3) {
            return document.createTextNode(node.nodeValue);
        }
        if (node.nodeType !== 1) return null; // drop comments, etc.

        const tag = node.tagName.toLowerCase();
        if (AID_TAGS.indexOf(tag) === -1) return null;

        const isSvg = node.namespaceURI === AID_SVG_NS;
        const el = isSvg
            ? document.createElementNS(AID_SVG_NS, tag)
            : document.createElement(tag);

        // Attributes — whitelist, then per-attribute rules.
        for (const attr of Array.from(node.attributes)) {
            const name = attr.name.toLowerCase();
            if (AID_ATTRS.indexOf(name) === -1) continue;
            let value = attr.value;

            if (name === "class") {
                value = value.split(/\s+/).filter((t) => t.indexOf("aid-") === 0).join(" ");
                if (!value) continue;
            } else if (name === "style") {
                value = value.split(";")
                    .map((d) => d.trim())
                    .filter((d) => d && AID_STYLE_DECL.test(d))
                    .join("; ");
                if (!value) continue;
            } else if (name === "src") {
                if (!this._srcAllowed(value)) return null; // drop the whole <img>
            }
            el.setAttribute(name, value);
        }

        for (const child of Array.from(node.childNodes)) {
            const clean = this._cleanNode(child);
            if (clean) el.appendChild(clean);
        }
        return el;
    },

    _srcAllowed: function (src) {
        const list = this.config.imgAllowlist || [];
        return list.some((prefix) => {
            // Match against bare host prefixes and full URLs alike.
            return src.indexOf(prefix) === 0
                || src.indexOf("//" + prefix) !== -1
                || src.indexOf("://" + prefix) !== -1;
        });
    }
});
