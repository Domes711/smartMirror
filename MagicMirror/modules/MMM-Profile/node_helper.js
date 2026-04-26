/* MMM-Profile — node_helper
 *
 * Owns the (presence, user) state machine and the cron-driven page
 * resolution, because cron-parser is a Node module that wouldn't load
 * cleanly in MagicMirror's browser context. The frontend is reduced to
 * "render the indicator + project the layout we tell it about".
 *
 * HTTP route:
 *   POST /mmm-profile/event   Content-Type: application/json
 *
 *   { "event": "presence_on" }
 *   { "event": "presence_off" }
 *   { "event": "user_recognized", "user": "Domes" }
 *   { "event": "user_unknown" }
 *
 * Frontend protocol:
 *   FE → BE   MMP_INIT { pages, defaultUser, dimTimeoutMs }
 *   BE → FE   MMP_STATE { state, currentUser, layout }
 *               state: "asleep" | "scanning" | "user" | "dimming"
 *               layout: [{ id, position }, …]    (globalLayout already merged)
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const express = require("express");
const cronParser = require("cron-parser");

const ROUTE = "/mmm-profile/event";
const DEFAULT_USER = "default";
const DEFAULT_DIM_MS = 60 * 1000;

module.exports = NodeHelper.create({

    start: function () {
        this.config = null;
        this.state = "asleep";
        this.currentUser = null;
        this.dimTimer = null;

        this.expressApp.post(ROUTE, express.json({ limit: "8kb" }), (req, res) => {
            const body = req.body;
            if (!body || typeof body !== "object" || !body.event) {
                Log.warn("[MMM-Profile] bad event body:", body);
                return res.status(400).end();
            }
            Log.info("[MMM-Profile] event:", body);
            this._handleEvent(body);
            res.status(204).end();
        });
        Log.info("[MMM-Profile] HTTP route mounted: POST " + ROUTE);
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMP_INIT") {
            this.config = payload || {};
            // Send the initial state so the frontend can paint immediately.
            this._push();
        }
    },

    // --- state machine -----------------------------------------------------

    _handleEvent: function (body) {
        switch (body.event) {
            case "presence_on":     this._onPresenceOn();              break;
            case "presence_off":    this._onPresenceOff();             break;
            case "user_recognized": this._onUserRecognized(body.user); break;
            case "user_unknown":    this._onUserUnknown();             break;
            default:
                Log.warn("[MMM-Profile] unknown event:", body.event);
                break;
        }
    },

    _onPresenceOn: function () {
        if (this._cancelDimTimer()) {
            // Re-entry inside the dim window: keep the same user.
            this.state = "user";
        } else {
            this.state = "scanning";
            this.currentUser = null;
        }
        this._push();
    },

    _onUserRecognized: function (user) {
        if (!user) return this._onUserUnknown();
        this.state = "user";
        this.currentUser = user;
        this._push();
    },

    _onUserUnknown: function () {
        this.state = "user";
        this.currentUser = this._defaultUser();
        this._push();
    },

    _onPresenceOff: function () {
        if (this.state === "asleep") return;
        this.state = "dimming";
        this._cancelDimTimer();
        const ms = (this.config && this.config.dimTimeoutMs) || DEFAULT_DIM_MS;
        this.dimTimer = setTimeout(() => {
            this.dimTimer = null;
            this.state = "asleep";
            this.currentUser = null;
            this._push();
        }, ms);
        // Push so the frontend tracks the dimming state, but layout/UI
        // intentionally don't change here per the spec.
        this._push();
    },

    _cancelDimTimer: function () {
        if (this.dimTimer) {
            clearTimeout(this.dimTimer);
            this.dimTimer = null;
            return true;
        }
        return false;
    },

    _defaultUser: function () {
        return (this.config && this.config.defaultUser) || DEFAULT_USER;
    },

    _push: function () {
        const layout = this._resolveLayout();
        this.sendSocketNotification("MMP_STATE", {
            state: this.state,
            currentUser: this.currentUser,
            layout: layout
        });
    },

    // --- page resolution ---------------------------------------------------

    _resolveLayout: function () {
        const pages = this.config && this.config.pages;
        if (!pages) return [];
        if (this.state === "asleep") return [];   // suppress globalLayout too

        const userKey = (this.state === "scanning" || !this.currentUser)
            ? this._defaultUser()
            : this.currentUser;

        const win = this._resolveWindow(userKey, new Date());
        const winLayout = (win && Array.isArray(win.layout)) ? win.layout : [];
        const global = Array.isArray(pages.globalLayout) ? pages.globalLayout : [];
        return global.concat(winLayout);
    },

    /**
     * Walk pages[userKey]'s windows; pick the one whose `from` cron fired
     * most recently AND more recently than its `to`. Returns the winner's
     * full window object (with `name` added) or null.
     */
    _resolveWindow: function (userKey, now) {
        const userBlock = (this.config.pages || {})[userKey];
        if (!userBlock || typeof userBlock !== "object") return null;

        let best = null;
        let bestFromMs = -Infinity;
        for (const [name, w] of Object.entries(userBlock)) {
            if (!w || !w.from || !w.to) continue;
            try {
                const fromIt = cronParser.parseExpression(w.from, { currentDate: now });
                const toIt = cronParser.parseExpression(w.to, { currentDate: now });
                const lastFromMs = fromIt.prev().getTime();
                const lastToMs = toIt.prev().getTime();
                if (lastFromMs > lastToMs && lastFromMs > bestFromMs) {
                    bestFromMs = lastFromMs;
                    best = Object.assign({ name }, w);
                }
            } catch (e) {
                Log.warn("[MMM-Profile] bad cron in pages."
                    + userKey + "." + name + ":", e.message);
            }
        }
        return best;
    }
});
