/* MMM-Assist-Status — node_helper
 *
 * Subscribes to the assistant-state MQTT topic (`mirror/assist/state`,
 * retained) and forwards each state to the frontend over socket.io.
 *
 * Watchdog: if the state is anything other than `idle` and no new message
 * arrives within `watchdogSec` seconds, we push `idle` ourselves. This is a
 * fail-safe against a stuck retained state — e.g. Home Assistant crashing
 * mid-query would otherwise strand the mirror on "listening" forever.
 *
 * node_helper is a singleton per module type: if two instances of this module
 * ever ran, they would share this one MQTT connection.
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const mqtt = require("mqtt");

const VALID = ["idle", "listening", "processing", "responding", "error"];

module.exports = NodeHelper.create({

    start: function () {
        this.client = null;
        this.stateTopic = null;
        this.watchdogMs = 30 * 1000;
        this.watchdog = null;
    },

    stop: function () {
        this._clearWatchdog();
        if (this.client) {
            this.client.end(true);
            this.client = null;
        }
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "ASSIST_INIT") {
            this._init(payload || {});
        }
    },

    _init: function (cfg) {
        this.stateTopic = cfg.stateTopic || "mirror/assist/state";
        this.watchdogMs = Math.max(5, cfg.watchdogSec || 30) * 1000;

        // Already connected (a second module instance re-INITs) — just make
        // sure we're subscribed to the configured topic.
        if (this.client && this.client.connected) {
            this.client.subscribe(this.stateTopic);
            return;
        }
        if (this.client) return; // connecting in progress

        const brokerUrl = cfg.mqttBroker || "mqtt://127.0.0.1:1883";
        this.client = mqtt.connect(brokerUrl, {
            clientId: "mm-assist-status",
            reconnectPeriod: 5000,
            clean: true
        });

        this.client.on("connect", () => {
            Log.info("[MMM-Assist-Status] MQTT connected to " + brokerUrl);
            this.client.subscribe(this.stateTopic, (err) => {
                if (err) Log.error("[MMM-Assist-Status] subscribe error:", err.message);
            });
        });

        this.client.on("message", (topic, message) => {
            if (topic !== this.stateTopic) return;
            const state = message.toString().trim();
            if (VALID.indexOf(state) === -1) {
                Log.warn("[MMM-Assist-Status] ignoring unknown state: " + state);
                return;
            }
            this.sendSocketNotification("ASSIST_STATE", state);
            this._armWatchdog(state);
        });

        this.client.on("error", (err) => Log.error("[MMM-Assist-Status] MQTT error:", err.message));
        this.client.on("offline", () => Log.warn("[MMM-Assist-Status] MQTT offline, reconnecting…"));
    },

    _armWatchdog: function (state) {
        this._clearWatchdog();
        if (state === "idle") return;
        this.watchdog = setTimeout(() => {
            this.watchdog = null;
            Log.warn("[MMM-Assist-Status] watchdog: no state change, falling back to idle");
            this.sendSocketNotification("ASSIST_STATE", "idle");
        }, this.watchdogMs);
    },

    _clearWatchdog: function () {
        if (this.watchdog) {
            clearTimeout(this.watchdog);
            this.watchdog = null;
        }
    }
});
