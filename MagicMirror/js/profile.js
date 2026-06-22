/**
 * ProfileManager — core presence/layout system for the smart mirror.
 *
 * Replaces the MMM-Profile module. Connects to MQTT, runs the state machine,
 * resolves the active cron-window layout, and emits PROFILE_STATE over
 * socket.io so the browser can project modules and render the Face ID indicator.
 *
 * MQTT subscriptions:
 *   smartmirror/radar/presence       "present" | "absent"
 *   smartmirror/camera/recognition   {"user":"Domes"} | {"user":null}
 *   smartmirror/control/reset        any
 *   smartmirror/profile/preview      {"layout":[{id,position}]}
 *   smartmirror/profile/reload       any  → cache-busts and re-reads config/pages.js
 *
 * Socket.io emissions:
 *   PROFILE_STATE   { state, currentUser, layout }
 *   PROFILE_PREVIEW { layout }
 */

const Log = require("logger");
const cronParser = require("cron-parser");
const mqtt = require("mqtt");
const path = require("path");

const DEFAULT_USER = "default";
const DEFAULT_DIM_MS = 60 * 1000;
const DEFAULT_MQTT_BROKER = "mqtt://127.0.0.1:1883";

const TOPIC_PRESENCE = "smartmirror/radar/presence";
const TOPIC_RECOGNITION = "smartmirror/camera/recognition";
const TOPIC_CONTROL = "smartmirror/control/reset";
const TOPIC_PREVIEW = "smartmirror/profile/preview";
const TOPIC_RELOAD = "smartmirror/profile/reload";

class ProfileManager {
	constructor (globalConfig, io) {
		this.cfg = (globalConfig && globalConfig.profile) || {};
		this.io = io;
		this.state = "asleep";
		this.currentUser = null;
		this.dimTimer = null;
		this.mqttClient = null;
		this.pages = null;
	}

	start () {
		this._loadPages();
		this._connectMQTT();
		this._push();

		// Re-send current state to any client that (re)connects after startup.
		this.io.on("connection", () => this._push());
	}

	stop () {
		this._cancelDimTimer();
		if (this.mqttClient) {
			this.mqttClient.end();
			this.mqttClient = null;
		}
	}

	// --- pages.js ----------------------------------------------------------

	_loadPages () {
		const pagesPath = path.resolve(global.root_path, "config", "pages.js");
		try {
			const resolved = require.resolve(pagesPath);
			delete require.cache[resolved];
		} catch (_) { /* file not found yet */ }
		try {
			this.pages = require(pagesPath);
			Log.info("[Profile] Loaded config/pages.js");
		} catch (err) {
			Log.warn("[Profile] config/pages.js not found or invalid:", err.message);
			this.pages = null;
		}
	}

	// --- MQTT --------------------------------------------------------------

	_connectMQTT () {
		const brokerUrl = this.cfg.mqttBroker || DEFAULT_MQTT_BROKER;
		this.mqttClient = mqtt.connect(brokerUrl, {
			clientId: "mm-profile-core",
			reconnectPeriod: 5000,
			clean: true
		});

		this.mqttClient.on("connect", () => {
			Log.info("[Profile] MQTT connected to " + brokerUrl);
			this.mqttClient.subscribe(
				[TOPIC_PRESENCE, TOPIC_RECOGNITION, TOPIC_CONTROL, TOPIC_PREVIEW, TOPIC_RELOAD],
				(err) => { if (err) Log.error("[Profile] MQTT subscribe error:", err); }
			);
		});

		this.mqttClient.on("message", (topic, message) => {
			this._handleMQTT(topic, message.toString());
		});

		this.mqttClient.on("error", (err) => Log.error("[Profile] MQTT error:", err));
		this.mqttClient.on("offline", () => Log.warn("[Profile] MQTT offline, reconnecting…"));
	}

	_handleMQTT (topic, payload) {
		try {
			if (topic === TOPIC_PRESENCE) {
				if (payload === "present") this._onPresenceOn();
				else if (payload === "absent") this._onPresenceOff();
			} else if (topic === TOPIC_RECOGNITION) {
				const data = JSON.parse(payload);
				if (data.user) this._onUserRecognized(data.user);
				else this._onUserUnknown();
			} else if (topic === TOPIC_CONTROL) {
				this._onReset();
			} else if (topic === TOPIC_PREVIEW) {
				const data = JSON.parse(payload);
				// `{exit:true}` leaves the app's scene-setup preview → restore live state
				if (data && data.exit) { this._push(); return; }
				const layout = Array.isArray(data) ? data : (data.layout || []);
				this.io.emit("PROFILE_PREVIEW", { layout, scene: (data && data.scene) || null });
			} else if (topic === TOPIC_RELOAD) {
				this._loadPages();
				this._push();
			}
		} catch (err) {
			Log.error("[Profile] MQTT message handling error:", err);
		}
	}

	// --- state machine -----------------------------------------------------

	_onPresenceOn () {
		if (this._cancelDimTimer()) {
			this.state = "user";
		} else {
			this.state = "scanning";
			this.currentUser = null;
		}
		this._push();
	}

	_onUserRecognized (user) {
		if (!user) return this._onUserUnknown();
		this.state = "user";
		this.currentUser = user;
		this._push();
	}

	_onUserUnknown () {
		this.state = "user";
		this.currentUser = this._defaultUser();
		this._push();
	}

	_onPresenceOff () {
		if (this.state === "asleep") return;
		this.state = "dimming";
		this._cancelDimTimer();
		const ms = this.cfg.dimTimeoutMs || DEFAULT_DIM_MS;
		this.dimTimer = setTimeout(() => {
			this.dimTimer = null;
			this.state = "asleep";
			this.currentUser = null;
			this._push();
		}, ms);
		this._push();
	}

	_onReset () {
		Log.info("[Profile] RESET received");
		this._cancelDimTimer();
		this.state = "asleep";
		this.currentUser = null;
		this._push();
	}

	_cancelDimTimer () {
		if (this.dimTimer) {
			clearTimeout(this.dimTimer);
			this.dimTimer = null;
			return true;
		}
		return false;
	}

	_defaultUser () {
		return this.cfg.defaultUser || DEFAULT_USER;
	}

	// --- layout resolution -------------------------------------------------

	_push () {
		const layout = this._resolveLayout();
		Log.info("[Profile] push state=" + this.state + " user=" + this.currentUser
			+ " layout=" + JSON.stringify(layout));
		this.io.emit("PROFILE_STATE", {
			state: this.state,
			currentUser: this.currentUser,
			layout
		});
	}

	_resolveLayout () {
		if (!this.pages) return [];
		const userKey = (this.state === "asleep" || this.state === "scanning" || !this.currentUser)
			? this._defaultUser()
			: this.currentUser;
		const win = this._resolveWindow(userKey, new Date());
		if (!win) {
			Log.warn("[Profile] No active window for user '" + userKey + "' — using default layout");
		}
		// Active time-window layout if one matches, otherwise the user's default
		// layout (config/pages.js → defaults[userKey]). When nobody is recognized
		// userKey is the built-in "default" user, so that profile drives the
		// no-recognition display — there is no separate always-on global layer.
		const layout = (win && Array.isArray(win.layout))
			? win.layout
			: (((this.pages.defaults || {})[userKey]) || []);
		return Array.isArray(layout) ? layout : [];
	}

	/**
	 * Walk pages[userKey]'s windows; pick the one whose `from` cron fired
	 * most recently AND more recently than its `to`. Returns the winner (with
	 * `name` added) or null.
	 */
	_resolveWindow (userKey, now) {
		const userBlock = (this.pages || {})[userKey];
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
				Log.warn("[Profile] Bad cron in pages." + userKey + "." + name + ":", e.message);
			}
		}
		return best;
	}
}

module.exports = ProfileManager;
