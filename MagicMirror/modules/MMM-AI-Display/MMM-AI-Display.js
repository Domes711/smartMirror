/* MMM-AI-Display
 *
 * The answer panel. Gemini (via Home Assistant) publishes a payload
 * {title, html, text, ttl} on `mirror/display/set`; node_helper forwards it
 * and the panel slides in from the top, shows the content, and slides back up
 * after `ttl` seconds. `mirror/display/clear` hides it immediately.
 *
 * TWO RENDER MODES (config.renderMode):
 *
 *   "sandbox" (default) — renders ARBITRARY HTML + CSS + JS. The content is
 *     dropped into a sandboxed <iframe srcdoc> with `sandbox="allow-scripts"`
 *     and NO `allow-same-origin`, so scripts run and CSS is unrestricted, but
 *     the content lives in an opaque origin: it CANNOT touch the mirror's DOM,
 *     socket.io, cookies or storage. The iframe auto-sizes to its content via a
 *     postMessage height reporter injected into the srcdoc.
 *
 *   "strict" — the original `aid-*` design system: a whitelist sanitizer that
 *     forbids scripts, free CSS and non-aid classes. Safer and visually
 *     uniform, but Gemini can only emit the catalog.
 *
 * Reference behaviour: assist-panel.html (design prototype).
 */

/* eslint-disable no-undef */

// --- strict-mode sanitizer whitelist -----------------------------------------
const AID_TAGS = [
    "div", "span", "b", "p", "ul", "li",
    "table", "thead", "tbody", "tr", "th", "td",
    "img", "svg", "polyline", "polygon", "circle", "g", "text"
];
const AID_ATTRS = [
    "class", "style", "src", "alt", "viewBox", "preserveAspectRatio",
    "points", "pathLength", "x", "y", "cx", "cy", "r", "colspan"
];
const AID_STYLE_DECL = /^\s*--[a-z0-9-]+\s*:\s*-?\d+(\.\d+)?%?\s*$/i;
const AID_SVG_NS = "http://www.w3.org/2000/svg";

// The `aid-*` catalog, inlined so it is also available INSIDE the sandbox
// iframe (existing aid-* payloads keep their look even in "sandbox" mode).
// Mirrors the content rules of MMM-AI-Display.css.
const AID_CATALOG_CSS = `
:root{--aid-fg:#fff;--aid-dim:#8a8a8a;--aid-hairline:1px solid rgba(255,255,255,.18);--aid-gap:14px}
body>*+*{margin-top:var(--aid-gap)}
.aid-big{font-size:3.4em;font-weight:200;line-height:1;letter-spacing:-.02em}
.aid-note{font-size:.8em;color:var(--aid-dim);line-height:1.5}
.aid-kv{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-bottom:var(--aid-hairline)}
.aid-kv+.aid-kv{margin-top:0}.aid-kv b{font-weight:500;white-space:nowrap}
.aid-table{width:100%;border-collapse:collapse;font-size:.9em}
.aid-table th{text-align:left;color:var(--aid-dim);font-weight:400;text-transform:uppercase;letter-spacing:.08em;font-size:.82em}
.aid-table td,.aid-table th{padding:7px 10px 7px 0;border-bottom:var(--aid-hairline)}
.aid-table td:last-child,.aid-table th:last-child{padding-right:0;text-align:right}
.aid-bar{position:relative;display:flex;justify-content:space-between;align-items:baseline;padding:8px 0 10px;font-size:.92em}
.aid-bar+.aid-bar{margin-top:0}
.aid-bar::before{content:"";position:absolute;inset:auto 0 0 0;height:2px;background:rgba(255,255,255,.12)}
.aid-bar::after{content:"";position:absolute;inset:auto auto 0 0;height:2px;width:calc(var(--v,0)*1%);background:var(--aid-fg)}
.aid-line{display:block;width:100%;height:74px;overflow:visible}
.aid-line polyline{fill:none;stroke:var(--aid-fg);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.aid-donut{display:block;width:118px;height:118px}
.aid-slice{cx:21px;cy:21px;r:15.9px;fill:none;stroke-width:5;transform:rotate(-90deg);transform-origin:center;stroke-dasharray:var(--pct,0) 100;stroke-dashoffset:calc(-1*var(--off,0))}
.aid-slice:nth-of-type(1){stroke:#fff}.aid-slice:nth-of-type(2){stroke:#9e9e9e}
.aid-slice:nth-of-type(3){stroke:#d0d0d0}.aid-slice:nth-of-type(4){stroke:#5c5c5c}
.aid-img{display:block;width:100%;border-radius:10px;border:1px solid rgba(255,255,255,.14)}
.aid-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.8em;color:var(--aid-dim)}
.aid-row{display:flex;align-items:center;gap:18px}.aid-row>*{margin-top:0!important}
`;

const AID_FONT = "https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@200;300;400;500&family=Roboto+Mono:wght@300;400&display=swap";

Module.register("MMM-AI-Display", {
    defaults: {
        mqttBroker: "mqtt://127.0.0.1:1883",
        setTopic: "mirror/display/set",
        clearTopic: "mirror/display/clear",
        availabilityTopic: "mirror/display/availability",
        defaultTitle: "ASISTENT",
        defaultTtl: 60,
        maxTtl: 900,
        renderMode: "sandbox",   // "sandbox" = arbitrary HTML/CSS/JS | "strict" = aid-* only
        maxHeightPx: 1400,       // sandbox: cap the auto-sized iframe height
        imgAllowlist: ["mirror.local"], // strict mode: allowed <img src> prefixes
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
        this._blankTimer = null;
        this._iframe = null;

        // Auto-size the sandbox iframe from height reports it postMessages up.
        // Sandboxed (no same-origin) content is a separate opaque origin, so we
        // verify by contentWindow, not origin (which is "null").
        this._onMsg = (e) => {
            if (!this._iframe || e.source !== this._iframe.contentWindow) return;
            const d = e.data;
            if (d && d.__aid === 1 && typeof d.h === "number") {
                const max = this.config.maxHeightPx || 1400;
                this._iframe.style.height = Math.max(0, Math.min(max, d.h)) + "px";
            }
        };
        window.addEventListener("message", this._onMsg);

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
        // Hide and kill any content JS so nothing runs behind a dark screen.
        this._clearTimers();
        this._hide();
        this._blankIframe();
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
        const html = payload.html != null ? String(payload.html) : "";
        const text = payload.text != null ? String(payload.text) : "";

        // Build the render step for the chosen mode. Returns false if there is
        // genuinely nothing to show (→ treat like a clear).
        const build = (this.config.renderMode === "strict")
            ? () => this._renderStrict(html, text)
            : () => this._renderSandbox(html, text);

        let ttl = parseInt(payload.ttl, 10);
        if (!Number.isFinite(ttl)) ttl = this.config.defaultTtl;
        ttl = Math.max(5, Math.min(this.config.maxTtl, ttl));

        const render = () => {
            this._titleEl.textContent = title;
            if (build() === false) { this._hide(); return; }
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

    // sandbox mode: arbitrary HTML/CSS/JS inside a locked-down iframe
    _renderSandbox: function (html, text) {
        let content = html.trim();
        // Strip a ```html … ``` markdown fence — Gemini sometimes wraps output.
        content = content
            .replace(/^```[a-z]*\s*\n?/i, "")
            .replace(/\n?```\s*$/i, "")
            .trim();
        if (!content && text.trim()) {
            // Fallback: plain text as an aid-note (escaped — it is not markup).
            content = '<div class="aid-note"></div>';
        }
        if (!content) return false;

        const doc = this._iframeDoc(content, (!html.trim() && text.trim()) ? text : null);

        // A fresh iframe per render resets the content's JS context (no leftover
        // timers from the previous answer).
        const frame = document.createElement("iframe");
        frame.className = "aid-frame";
        // allow-scripts WITHOUT allow-same-origin → scripts run, but in an
        // opaque origin that cannot reach the parent mirror document.
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("scrolling", "no");
        frame.style.width = "100%";
        frame.style.border = "0";
        frame.style.display = "block";
        frame.style.background = "transparent";
        frame.style.height = "0px";
        frame.srcdoc = doc;

        this._bodyEl.innerHTML = "";
        this._bodyEl.appendChild(frame);
        this._iframe = frame;
        return true;
    },

    _iframeDoc: function (bodyHtml, plainTextNote) {
        // If a plain-text fallback was requested, inject it as textContent-safe
        // markup (no interpolation of untrusted text into element context).
        let body = bodyHtml;
        if (plainTextNote != null) {
            const esc = plainTextNote
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            body = '<div class="aid-note">' + esc + "</div>";
        }
        // Height reporter: tells the parent how tall the content is so the
        // iframe can auto-size. Must use scrollHeight, not the element's own
        // rect — the iframe starts at 0px so documentElement's rect is 0 too
        // (circular) — and must measure AFTER layout (rAF), not synchronously.
        // Written split so it survives any inline embed.
        const reporter =
            "<scr" + "ipt>(function(){function r(){var b=document.body,e=document.documentElement;"
            + "var h=Math.max(b?b.scrollHeight:0,e.scrollHeight,b?b.offsetHeight:0);"
            + "parent.postMessage({__aid:1,h:h},'*');}"
            + "try{new ResizeObserver(r).observe(document.body);}catch(e){}"
            + "addEventListener('load',r);requestAnimationFrame(r);"
            + "setTimeout(r,80);setTimeout(r,300);})();</scr" + "ipt>";

        // The font is loaded NON-blocking (media=print → all onload): a
        // render-blocking <link> would stall the reporter script if the font
        // host is slow/offline. On the Pi 'Roboto Condensed' is installed
        // system-wide, so the fallback stack matches even without the link.
        return "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<link rel=\"stylesheet\" href=\"" + AID_FONT + "\" media=\"print\" "
            + "onload=\"this.media='all'\">"
            // Match the panel's own black so the number/text (white) is always
            // legible; a sandboxed iframe paints an opaque white backdrop by
            // default, and the panel is #000 anyway. Content CSS can override.
            + "<style>html,body{margin:0;background:#000;color:#fff;"
            + "font-family:'Roboto Condensed',system-ui,'Segoe UI',sans-serif;font-weight:300;"
            + "-webkit-font-smoothing:antialiased;overflow:hidden}"
            + AID_CATALOG_CSS + "</style></head><body>"
            + body + reporter + "</body></html>";
    },

    // strict mode: aid-* whitelist sanitizer (no scripts, no free CSS)
    _renderStrict: function (html, text) {
        const frag = this._sanitize(html);
        if (!frag.childNodes.length && text.trim()) {
            const note = document.createElement("div");
            note.className = "aid-note";
            note.textContent = text;
            frag.appendChild(note);
        }
        if (!frag.childNodes.length) return false;
        this._iframe = null;
        this._bodyEl.innerHTML = "";
        this._bodyEl.appendChild(frag);
        return true;
    },

    _show: function () {
        this._open = true;
        if (this._holder) this._holder.classList.add("is-open");
    },

    _hide: function () {
        this._open = false;
        if (this._holder) this._holder.classList.remove("is-open");
        if (this._ttlTimer) { clearTimeout(this._ttlTimer); this._ttlTimer = null; }
        // Once the exit animation has played, blank the iframe so its JS (any
        // setInterval etc.) stops running behind the hidden panel.
        if (this._iframe) {
            clearTimeout(this._blankTimer);
            this._blankTimer = setTimeout(() => {
                if (!this._open) this._blankIframe();
            }, 700);
        }
    },

    _blankIframe: function () {
        if (this._iframe) this._iframe.srcdoc = "<!doctype html>";
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
        if (this._blankTimer) { clearTimeout(this._blankTimer); this._blankTimer = null; }
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

    // --- strict-mode sanitizer ---------------------------------------------

    /**
     * Turn untrusted HTML into a DocumentFragment of whitelisted nodes.
     * Everything not explicitly allowed is dropped. Only used in "strict" mode.
     */
    _sanitize: function (rawHtml) {
        const frag = document.createDocumentFragment();
        let html = String(rawHtml || "");
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
        if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
        if (node.nodeType !== 1) return null;

        const tag = node.tagName.toLowerCase();
        if (AID_TAGS.indexOf(tag) === -1) return null;

        const isSvg = node.namespaceURI === AID_SVG_NS;
        const el = isSvg
            ? document.createElementNS(AID_SVG_NS, tag)
            : document.createElement(tag);

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
                if (!this._srcAllowed(value)) return null;
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
            return src.indexOf(prefix) === 0
                || src.indexOf("//" + prefix) !== -1
                || src.indexOf("://" + prefix) !== -1;
        });
    }
});
