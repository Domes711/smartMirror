/* MMM-Assist-Status
 *
 * Colour wave visualisation of the voice-assistant state, drawn on a
 * <canvas>. Sits under the recognised-user indicator (Face ID). The state
 * arrives over MQTT (`mirror/assist/state`) via node_helper and is applied
 * with socketNotificationReceived — the canvas morphs between states by
 * lerping every dot toward per-frame target shapes, so nothing ever blinks.
 *
 * States: idle | listening | processing | responding | error
 * Reference behaviour: assist-status.html (design prototype).
 */

/* eslint-disable no-undef */

const AS_N = 8;
const AS_PALETTE = ["#4285F4", "#EA4335", "#FBBC05", "#34A853"];
const AS_COLORS = Array.from({ length: AS_N }, (_, i) => AS_PALETTE[i % AS_PALETTE.length]);
const AS_RED = "#EA4335";

const AS_ENTER_STAGGER = 55; // ms between neighbouring dots on arrival
const AS_EXIT_STAGGER = 40;  // ms on departure
const AS_DOT = 6;            // resting dot size (px)
const AS_ABOVE = -16;       // resting Y above the canvas (hidden)

const AS_STATES = ["idle", "listening", "processing", "responding", "error"];

Module.register("MMM-Assist-Status", {
    defaults: {
        mqttBroker: "mqtt://127.0.0.1:1883",
        stateTopic: "mirror/assist/state",
        watchdogSec: 30,   // fall back to idle if stuck in a non-idle state
        height: 52         // canvas height in px
    },

    getStyles: function () {
        return ["MMM-Assist-Status.css"];
    },

    start: function () {
        this.assistState = "idle";
        this._raf = null;
        this._t = 0;
        this._W = 0;
        this._H = 0;
        this._cx = 0;
        this._cy = 0;
        this._waveMix = 0;
        this._targetWave = 0;
        this._levels = new Array(AS_N).fill(0);
        this._transStart = -9999;
        this._fromIdle = false;
        this._toIdle = false;

        // Each dot starts idle: above the canvas, invisible.
        this._dots = AS_COLORS.map(() => ({
            x: 0, y: AS_ABOVE, w: AS_DOT, h: AS_DOT, a: 0,
            tx: 0, ty: AS_ABOVE, tw: AS_DOT, th: AS_DOT, ta: 0
        }));

        this.sendSocketNotification("ASSIST_INIT", {
            mqttBroker: this.config.mqttBroker,
            stateTopic: this.config.stateTopic,
            watchdogSec: this.config.watchdogSec
        });
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "ASSIST_STATE") {
            this._setState(payload);
        }
    },

    suspend: function () {
        // Stop the canvas loop when the display is off, otherwise it keeps
        // the Pi busy behind a black screen.
        if (this._raf) {
            cancelAnimationFrame(this._raf);
            this._raf = null;
        }
    },

    resume: function () {
        if (!this._raf && this._canvas) {
            this._raf = requestAnimationFrame(() => this._frame());
        }
    },

    getDom: function () {
        // Build the canvas once and keep re-returning the same node — the
        // animation drives it directly, we never updateDom() after init.
        if (!this._wrap) {
            this._wrap = document.createElement("div");
            this._wrap.className = "mm-assist-status";
            this._wrap.style.height = this.config.height + "px";

            this._canvas = document.createElement("canvas");
            this._canvas.setAttribute("aria-hidden", "true");
            this._canvas.style.height = this.config.height + "px";
            this._wrap.appendChild(this._canvas);

            this._ctx = this._canvas.getContext("2d");
            this._resize();
            if (!this._raf) {
                this._raf = requestAnimationFrame(() => this._frame());
            }
        }
        return this._wrap;
    },

    // --- geometry ----------------------------------------------------------

    _resize: function () {
        const dpr = window.devicePixelRatio || 1;
        const rect = this._canvas.getBoundingClientRect();
        const w = rect.width || this._canvas.clientWidth || 200;
        const h = rect.height || this.config.height;
        this._W = w;
        this._H = h;
        this._canvas.width = Math.round(w * dpr);
        this._canvas.height = Math.round(h * dpr);
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._cx = w / 2;
        this._cy = h / 2;
    },

    _gapSize: function () {
        return Math.min(17, this._W / (AS_N + 4));
    },

    _homeX: function (i) {
        return this._cx + (i - (AS_N - 1) / 2) * this._gapSize();
    },

    // --- state -------------------------------------------------------------

    _setState: function (state) {
        if (AS_STATES.indexOf(state) === -1) return;
        const prev = this.assistState;
        if (prev === state) return;

        this._fromIdle = (prev === "idle" && state !== "idle");
        this._toIdle = (state === "idle" && prev !== "idle");
        this._transStart = performance.now();

        // Arrivals start from above the canvas, not from wherever the dots
        // happened to be, so the wave reads as "flowing in from the top".
        if (this._fromIdle) {
            this._dots.forEach((d, i) => {
                d.x = this._homeX(i); d.y = AS_ABOVE;
                d.w = AS_DOT; d.h = AS_DOT; d.a = 0;
            });
            this._waveMix = 0;
        }

        this.assistState = state;
        if (state !== "listening") this._levels.fill(0);
    },

    // --- simulation (no live mic) ------------------------------------------

    _simulate: function () {
        const t = this._t;
        for (let i = 0; i < AS_N; i++) {
            const s1 = Math.sin(t * (1.6 + i * 0.21) + i * 1.7);
            const s2 = Math.sin(t * (3.7 + i * 0.38) + i * 0.9);
            const v = s1 * 0.5 + s2 * 0.3 + 0.5;
            this._levels[i] = Math.max(0, Math.min(1, v * v * (1 - i * 0.05)));
        }
    },

    // --- target shapes -----------------------------------------------------

    _computeTargets: function (state) {
        const elapsed = performance.now() - this._transStart;
        const dots = this._dots;
        const cx = this._cx;
        const cy = this._cy;
        const t = this._t;

        if (state === "idle") {
            this._targetWave = 0;
            dots.forEach((d, i) => {
                d.tw = AS_DOT; d.th = AS_DOT; d.tx = this._homeX(i);
                // depart back-to-front: the last dot leaves first
                const delay = this._toIdle ? (AS_N - 1 - i) * AS_EXIT_STAGGER : 0;
                if (elapsed < delay) {
                    d.ty = cy; d.ta = 1;
                } else {
                    d.ty = AS_ABOVE; d.ta = 0;
                }
            });
            return;
        }

        const holdAbove = (i) => this._fromIdle && elapsed < i * AS_ENTER_STAGGER;

        if (state === "listening") {
            this._targetWave = 0;
            dots.forEach((d, i) => {
                d.tx = this._homeX(i); d.tw = AS_DOT;
                if (holdAbove(i)) {
                    d.ty = AS_ABOVE; d.th = AS_DOT; d.ta = 0;
                } else {
                    d.ty = cy;
                    d.th = AS_DOT + this._levels[i] * (this._H - 18);
                    d.ta = 1;
                }
            });
            return;
        }

        if (state === "processing") {
            this._targetWave = 0;
            const r = Math.min(32, this._W / 8);
            const sp = t * 2.2;
            dots.forEach((d, i) => {
                d.tw = AS_DOT; d.th = AS_DOT;
                if (holdAbove(i)) {
                    d.tx = this._homeX(i); d.ty = AS_ABOVE; d.ta = 0;
                } else {
                    const ang = sp + i * (Math.PI * 2 / AS_N);
                    d.tx = cx + Math.cos(ang) * r;
                    d.ty = cy + Math.sin(ang) * (r * 0.28); // flattened, not a circle
                    d.ta = 1;
                }
            });
            return;
        }

        if (state === "responding") {
            // dots fade out, expanding wave lines take over
            this._targetWave = 1;
            dots.forEach((d, i) => {
                d.tx = this._homeX(i); d.ty = cy; d.tw = AS_DOT; d.th = AS_DOT;
                d.ta = 0;
                if (holdAbove(i)) d.ty = AS_ABOVE;
            });
            return;
        }

        // error
        this._targetWave = 0;
        const pulse = AS_DOT + Math.sin(t * 6) * 2.2;
        dots.forEach((d, i) => {
            d.tx = cx + (i - (AS_N - 1) / 2) * 4.5;
            d.ty = holdAbove(i) ? AS_ABOVE : cy;
            d.tw = pulse; d.th = pulse;
            d.ta = holdAbove(i) ? 0 : 1;
        });
    },

    // --- drawing -----------------------------------------------------------

    _roundRect: function (x, y, w, h, r) {
        const ctx = this._ctx;
        ctx.beginPath();
        const rr = Math.min(r, w / 2, h / 2);
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    },

    _drawDots: function (state) {
        const ctx = this._ctx;
        const err = state === "error";
        this._dots.forEach((d, i) => {
            if (d.a < 0.01) return;
            const color = err ? AS_RED : AS_COLORS[i];
            ctx.globalAlpha = d.a;
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            this._roundRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h, d.w / 2);
            ctx.fill();
        });
    },

    _drawWave: function (grow) {
        const ctx = this._ctx;
        const W = this._W;
        const cy = this._cy;
        const H = this._H;
        const t = this._t;
        const lerp = (a, b, k) => a + (b - a) * k;
        const steps = 64;
        ctx.shadowBlur = 10;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const e = 1 - Math.pow(1 - grow, 2.2);

        for (let i = 0; i < AS_N; i++) {
            const hx = this._homeX(i);
            const x0 = lerp(hx - AS_DOT / 2, 0, e);
            const x1 = lerp(hx + AS_DOT / 2, W, e);

            ctx.globalAlpha = lerp(1, 0.78, e);
            ctx.lineWidth = lerp(AS_DOT, 2.4, e);
            ctx.strokeStyle = AS_COLORS[i];
            ctx.shadowColor = AS_COLORS[i];

            ctx.beginPath();
            for (let s = 0; s <= steps; s++) {
                const x = x0 + (x1 - x0) * (s / steps);
                const p = x / W;
                const win = Math.sin(Math.max(0, Math.min(1, p)) * Math.PI);
                const amp = (H * 0.30) * win * (1 - i * 0.06) * e;
                const y = cy + Math.sin(p * (4.6 + i * 0.42) - t * (2.4 + i * 0.17)) * amp;
                s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    },

    _frame: function () {
        this._raf = requestAnimationFrame(() => this._frame());
        this._t += 1 / 60;

        // Pick up region width once the module is projected into a visible
        // region (in staging the canvas has zero width).
        const rect = this._canvas.getBoundingClientRect();
        if (rect.width && Math.abs(rect.width - this._W) > 0.5) {
            this._resize();
        }

        const state = this.assistState;
        if (state === "listening") this._simulate();

        this._computeTargets(state);

        const lerp = (a, b, k) => a + (b - a) * k;
        const kh = state === "listening" ? 0.35 : 0.16;
        this._dots.forEach((d) => {
            d.x = lerp(d.x, d.tx, 0.18);
            d.y = lerp(d.y, d.ty, 0.13);
            d.w = lerp(d.w, d.tw, 0.18);
            d.h = lerp(d.h, d.th, kh);
            d.a = lerp(d.a, d.ta, 0.16);
        });
        this._waveMix = lerp(this._waveMix, this._targetWave, 0.075);

        const ctx = this._ctx;
        ctx.clearRect(0, 0, this._W, this._H);
        ctx.globalCompositeOperation = "lighter"; // overlapping colours glow

        if (this._waveMix > 0.004) this._drawWave(this._waveMix);
        this._drawDots(state);

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = "source-over";
    }
});
