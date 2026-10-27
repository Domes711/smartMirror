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
 *   smartmirror/control/wake         any  → leave sleep and project the live layout
 *   smartmirror/control/message      {"message":"…","timer":600000} → note on the mirror
 *   smartmirror/profile/preview      {"layout":[{id,position}]}
 *   smartmirror/profile/reload       any  → cache-busts and re-reads config/pages.js
 *
 * Socket.io emissions:
 *   PROFILE_STATE   { state, currentUser, layout }
 *   PROFILE_PREVIEW { layout }
 *   MIRROR_MESSAGE  { message, title, timer }
 */

const Log = require("logger");
const cronParser = require("cron-parser");
const mqtt = require("mqtt");
const path = require("path");

const DEFAULT_USER = "default";
const DEFAULT_DIM_MS = 60 * 1000;
const DEFAULT_MQTT_BROKER = "mqtt://127.0.0.1:1883";
// A scene-setup preview is ephemeral: if the editor tab dies without sending
// `{exit:true}` (closed mid-edit, lost network), the mirror would be stranded on
// the preview layout — possibly empty/black. Auto-restore the live state if no
// further preview/exit arrives within this window.
const PREVIEW_TTL_MS = 90 * 1000;

const TOPIC_PRESENCE = "smartmirror/radar/presence";
const TOPIC_RECOGNITION = "smartmirror/camera/recognition";
const TOPIC_CONTROL = "smartmirror/control/reset";
const TOPIC_WAKE = "smartmirror/control/wake";
const TOPIC_MESSAGE = "smartmirror/control/message";
const TOPIC_PREVIEW = "smartmirror/profile/preview";
const TOPIC_RELOAD = "smartmirror/profile/reload";
// The display feature resolves `monitor_config` (defaults + the active
// profile's overrides) and pushes it here, retained. The core owns the
// dim/sleep timers but has no database driver, so the values come over the
// bus rather than being read from SQLite or pinned in config.js.
const TOPIC_DISPLAY_CONFIG = "smartmirror/display/config";
// Tells the display feature whose overrides to resolve.
const TOPIC_DISPLAY_PROFILE = "smartmirror/display/control/profile";
// Scenes asks the core to load a newly placed module without a pm2 restart.
// Replaces the HTTP POST /module/hot-load the scenes feature used to make.
const TOPIC_HOT_LOAD = "smartmirror/core/hot-load";
const TOPIC_HOT_LOAD_RESULT = "smartmirror/core/hot-load/result";

class ProfileManager {
	constructor (globalConfig, io, hooks) {
		this.cfg = (globalConfig && globalConfig.profile) || {};
		this.io = io;
		// Injected by app.js — loads a module into the running core.
		this.hotLoadModule = (hooks && hooks.hotLoadModule) || null;
		this.state = "asleep";
		this.currentUser = null;
		this.dimTimer = null;
		// Resolved monitor_config for the active profile, pushed by the
		// display feature over MQTT (retained).
		this.displayConfig = null;
		this.previewTimer = null;
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
		this._cancelPreviewTimer();
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
				[TOPIC_PRESENCE, TOPIC_RECOGNITION, TOPIC_CONTROL, TOPIC_WAKE, TOPIC_MESSAGE, TOPIC_PREVIEW, TOPIC_RELOAD, TOPIC_HOT_LOAD, TOPIC_DISPLAY_CONFIG],
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
			} else if (topic === TOPIC_WAKE) {
				this._onWake();
			} else if (topic === TOPIC_MESSAGE) {
				this._onMessage(payload);
			} else if (topic === TOPIC_HOT_LOAD) {
				// async, deliberately not awaited — guard its promise so a
				// rejection cannot escape as an unhandled rejection.
				this._onHotLoad(payload).catch((err) => Log.error("[Profile] hot-load error:", err));
			} else if (topic === TOPIC_PREVIEW) {
				const data = JSON.parse(payload);
				// `{exit:true}` leaves the app's scene-setup preview → restore live state
				this._cancelPreviewTimer();
				if (data && data.exit) { this._push(); return; }
				const layout = Array.isArray(data) ? data : (data.layout || []);
				this.io.emit("PROFILE_PREVIEW", { layout, scene: (data && data.scene) || null });
				// Fail-safe: if the editor never sends `{exit:true}` (tab closed
				// mid-edit), restore the live layout so the mirror is never stranded.
				this.previewTimer = setTimeout(() => {
					this.previewTimer = null;
					Log.warn("[Profile] Preview TTL expired — restoring live state");
					this._push();
				}, PREVIEW_TTL_MS);
			} else if (topic === TOPIC_RELOAD) {
				this._loadPages();
				this._push();
			} else if (topic === TOPIC_DISPLAY_CONFIG) {
				this._onDisplayConfig(JSON.parse(payload));
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
		// Ask for this person's monitor settings: the timeouts are per
		// profile, so a recognition must re-resolve them rather than keep the
		// previous user's.
		this._requestDisplayConfig(user);
		this._push();
	}

	/**
	 * Resolved `monitor_config` arrived. Only the timers the core owns are
	 * kept; brightness is applied by the display feature itself.
	 */
	_onDisplayConfig (cfg) {
		if (!cfg || typeof cfg !== "object") return;
		this.displayConfig = cfg;
		Log.info("[Profile] monitor config for " + (cfg.profile || "default")
			+ ": dim=" + cfg.dim_timeout_s + "s");
		// A dim already counting down was started with the previous value;
		// restart it so the new timeout applies immediately instead of at the
		// next absence.
		if (this.state === "dimming" && this.dimTimer) {
			this._cancelDimTimer();
			this._onPresenceOff();
		}
	}

	_requestDisplayConfig (profile) {
		if (!this.mqttClient) return;
		this.mqttClient.publish(TOPIC_DISPLAY_PROFILE, profile || DEFAULT_USER);
	}

	/**
	 * Dim timeout, in order of precedence: the profile's resolved
	 * monitor_config, then config.js, then the constant.
	 */
	_dimTimeoutMs () {
		const fromDb = this.displayConfig && this.displayConfig.dim_timeout_s;
		if (typeof fromDb === "number" && fromDb > 0) return fromDb * 1000;
		return this.cfg.dimTimeoutMs || DEFAULT_DIM_MS;
	}

	_onUserUnknown () {
		this.state = "user";
		this.currentUser = this._defaultUser();
		// Fall back to the default profile's settings too — otherwise an
		// unrecognized face would inherit the timeouts of whoever was here
		// last.
		this._requestDisplayConfig(this.currentUser);
		this._push();
	}

	_onPresenceOff () {
		if (this.state === "asleep") return;
		this.state = "dimming";
		this._cancelDimTimer();
		const ms = this._dimTimeoutMs();
		this.dimTimer = setTimeout(() => {
			this.dimTimer = null;
			this.state = "asleep";
			this.currentUser = null;
			this._push();
		}, ms);
		this._push();
	}

	/** Manual wake from the app: leave sleep/dimming and show the live layout. */
	_onWake () {
		Log.info("[Profile] WAKE received");
		this._cancelDimTimer();
		this.state = "user";
		if (!this.currentUser) this.currentUser = this._defaultUser();
		this._push();
	}

	/** A note sent from the app — forwarded to the browser's alert module. */
	_onMessage (payload) {
		let data;
		try {
			data = JSON.parse(payload);
		} catch {
			data = { message: payload };
		}
		const message = (data && (data.message || data.text)) || "";
		if (!message) return;
		Log.info("[Profile] message: " + message);
		this.io.emit("MIRROR_MESSAGE", {
			title: (data && data.title) || null,
			message,
			timer: (data && Number(data.timer)) || 0
		});
	}

	/**
	 * Load a module into the running core on behalf of the scenes feature and
	 * answer on TOPIC_HOT_LOAD_RESULT. Scenes keys the reply by moduleId and
	 * falls back to a full pm2 restart if no reply arrives, so a failure here
	 * must still publish — silence is the one unrecoverable outcome.
	 */
	async _onHotLoad (payload) {
		let data = {};
		try {
			data = JSON.parse(payload);
		} catch {
			Log.error("[Profile] hot-load: payload is not JSON");
			return;
		}
		const reply = (ok, error) => {
			try {
				this.mqttClient.publish(
					TOPIC_HOT_LOAD_RESULT,
					JSON.stringify({ moduleId: data.moduleId, moduleName: data.moduleName, ok, error: error || null })
				);
			} catch (e) {
				// Scenes treats no-reply as failure and restarts pm2, so the
				// module still lands — log and move on.
				Log.error("[Profile] hot-load: could not publish result:", e.message);
			}
		};
		if (!this.hotLoadModule) {
			Log.error("[Profile] hot-load: no loader injected");
			return reply(false, "hot-load unavailable");
		}
		try {
			const result = await this.hotLoadModule(data);
			reply(Boolean(result && result.ok), result && result.error);
		} catch (e) {
			Log.error("[Profile] hot-load failed:", e.message);
			reply(false, e.message);
		}
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

	_cancelPreviewTimer () {
		if (this.previewTimer) {
			clearTimeout(this.previewTimer);
			this.previewTimer = null;
		}
	}

	_defaultUser () {
		return this.cfg.defaultUser || DEFAULT_USER;
	}

	// --- layout resolution -------------------------------------------------

	_push () {
		// A real state push supersedes any pending scene-setup preview.
		this._cancelPreviewTimer();
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
