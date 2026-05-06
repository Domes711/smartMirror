/* MMM-Profile — node_helper
 *
 * Owns the (presence, user) state machine and the cron-driven page
 * resolution, because cron-parser is a Node module that wouldn't load
 * cleanly in MagicMirror's browser context. The frontend is reduced to
 * "render the indicator + project the layout we tell it about".
 *
 * MQTT subscriptions:
 *   smartmirror/radar/presence       payload: "present" | "absent"
 *   smartmirror/camera/recognition   payload: {"user": "Domes"} | {"user": null}
 *   smartmirror/control/reset        payload: any (resets to initial state)
 *
 * Frontend protocol:
 *   FE → BE   MMP_INIT { pages, defaultUser, dimTimeoutMs, mqttBroker, mqttPort }
 *   BE → FE   MMP_STATE { state, currentUser, layout }
 *               state: "asleep" | "scanning" | "user" | "dimming"
 *               layout: [{ id, position }, …]    (globalLayout already merged)
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const cronParser = require("cron-parser");
const mqtt = require("mqtt");

const DEFAULT_USER = "default";
const DEFAULT_DIM_MS = 60 * 1000;
const DEFAULT_MQTT_BROKER = "mqtt://127.0.0.1:1883";

const TOPIC_PRESENCE = "smartmirror/radar/presence";
const TOPIC_RECOGNITION = "smartmirror/camera/recognition";
const TOPIC_CONTROL = "smartmirror/control/reset";

module.exports = NodeHelper.create({

    start: function () {
        this.config = null;
        this.state = "asleep";
        this.currentUser = null;
        this.dimTimer = null;
        this.mqttClient = null;
        Log.info("[MMM-Profile] node_helper started");
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMP_INIT") {
            this.config = payload || {};
            this._connectMQTT();
            // Send the initial state so the frontend can paint immediately.
            this._push();
        }
    },

    stop: function () {
        if (this.mqttClient) {
            this.mqttClient.end();
            this.mqttClient = null;
        }
    },

    // --- MQTT connection ---------------------------------------------------

    _connectMQTT: function () {
        const brokerUrl = (this.config && this.config.mqttBroker) || DEFAULT_MQTT_BROKER;

        this.mqttClient = mqtt.connect(brokerUrl, {
            clientId: "mmm-profile",
            reconnectPeriod: 5000,
            clean: true
        });

        this.mqttClient.on("connect", () => {
            Log.info("[MMM-Profile] MQTT connected to " + brokerUrl);
            this.mqttClient.subscribe([TOPIC_PRESENCE, TOPIC_RECOGNITION, TOPIC_CONTROL], (err) => {
                if (err) {
                    Log.error("[MMM-Profile] MQTT subscribe failed:", err);
                } else {
                    Log.info("[MMM-Profile] MQTT subscribed to topics");
                }
            });
        });

        this.mqttClient.on("message", (topic, message) => {
            this._handleMQTTMessage(topic, message.toString());
        });

        this.mqttClient.on("error", (err) => {
            Log.error("[MMM-Profile] MQTT error:", err);
        });

        this.mqttClient.on("offline", () => {
            Log.warn("[MMM-Profile] MQTT offline, will reconnect...");
        });
    },

    _handleMQTTMessage: function (topic, payload) {
        Log.info("[MMM-Profile] MQTT message:", topic, payload);

        try {
            if (topic === TOPIC_PRESENCE) {
                if (payload === "present") {
                    this._onPresenceOn();
                } else if (payload === "absent") {
                    this._onPresenceOff();
                }
            } else if (topic === TOPIC_RECOGNITION) {
                const data = JSON.parse(payload);
                if (data.user) {
                    this._onUserRecognized(data.user);
                } else {
                    this._onUserUnknown();
                }
            } else if (topic === TOPIC_CONTROL) {
                this._onReset();
            }
        } catch (err) {
            Log.error("[MMM-Profile] failed to handle MQTT message:", err);
        }
    },

    // --- state machine -----------------------------------------------------

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

    _onReset: function () {
        Log.info("[MMM-Profile] RESET command received, resetting to initial state");
        this._cancelDimTimer();
        this.state = "asleep";
        this.currentUser = null;
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
