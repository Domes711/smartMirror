/* MMM-AI-Display — node_helper
 *
 * MQTT bridge for the answer panel:
 *   - subscribes `mirror/display/set`   → JSON {title, html, text, ttl}
 *   - subscribes `mirror/display/clear` → hide the panel now
 *   - publishes `mirror/display/availability` online/offline (retained), with
 *     `offline` registered as the MQTT Last-Will so a crash marks us offline.
 *
 * The raw HTML is passed through untouched — the frontend sanitizer is the
 * single security boundary (it runs where the DOM is).
 *
 * node_helper is a singleton per module type: two instances would share this
 * one MQTT connection.
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const mqtt = require("mqtt");

module.exports = NodeHelper.create({

    start: function () {
        this.client = null;
        this.setTopic = null;
        this.clearTopic = null;
        this.availabilityTopic = null;
    },

    stop: function () {
        if (this.client) {
            if (this.availabilityTopic) {
                this.client.publish(this.availabilityTopic, "offline", { retain: true, qos: 1 });
            }
            this.client.end();
            this.client = null;
        }
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "AID_INIT") {
            this._init(payload || {});
        }
    },

    _init: function (cfg) {
        this.setTopic = cfg.setTopic || "mirror/display/set";
        this.clearTopic = cfg.clearTopic || "mirror/display/clear";
        this.availabilityTopic = cfg.availabilityTopic || "mirror/display/availability";

        if (this.client && this.client.connected) {
            this.client.subscribe([this.setTopic, this.clearTopic]);
            return;
        }
        if (this.client) return; // connecting

        const brokerUrl = cfg.mqttBroker || "mqtt://127.0.0.1:1883";
        this.client = mqtt.connect(brokerUrl, {
            clientId: "mm-ai-display",
            reconnectPeriod: 5000,
            clean: true,
            will: {
                topic: this.availabilityTopic,
                payload: "offline",
                retain: true,
                qos: 1
            }
        });

        this.client.on("connect", () => {
            Log.info("[MMM-AI-Display] MQTT connected to " + brokerUrl);
            this.client.publish(this.availabilityTopic, "online", { retain: true, qos: 1 });
            this.client.subscribe([this.setTopic, this.clearTopic], (err) => {
                if (err) Log.error("[MMM-AI-Display] subscribe error:", err.message);
            });
        });

        this.client.on("message", (topic, message) => {
            if (topic === this.setTopic) {
                let data;
                try {
                    data = JSON.parse(message.toString());
                } catch (e) {
                    Log.warn("[MMM-AI-Display] set payload is not JSON:", e.message);
                    return;
                }
                this.sendSocketNotification("AID_SET", data);
            } else if (topic === this.clearTopic) {
                this.sendSocketNotification("AID_CLEAR");
            }
        });

        this.client.on("error", (err) => Log.error("[MMM-AI-Display] MQTT error:", err.message));
        this.client.on("offline", () => Log.warn("[MMM-AI-Display] MQTT offline, reconnecting…"));
    }
});
