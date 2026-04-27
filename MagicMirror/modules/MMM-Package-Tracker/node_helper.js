/* MMM-Package-Tracker — node_helper
 *
 * Polls a Home Assistant todo list of tracking numbers, enriches each
 * with carrier + status from AfterShip, and pushes the result to the
 * frontend. On-disk cache keeps state between MM restarts so we don't
 * re-register tracking numbers that AfterShip already knows.
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const fs = require("fs");
const path = require("path");

const AFTERSHIP_BASE = "https://api.aftership.com/tracking/2024-04";
const CACHE_FILENAME = "cache.json";

module.exports = NodeHelper.create({

    start: function () {
        this.config = null;
        this.timer = null;
        this.cache = {};
        this.cachePath = path.join(__dirname, CACHE_FILENAME);
        this._loadCache();
    },

    stop: function () {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMPT_INIT") {
            this.config = payload;
            if (this.timer) clearInterval(this.timer);
            this._tick();
            this.timer = setInterval(
                () => this._tick(),
                (this.config.refreshSec || 1800) * 1000
            );
        }
    },

    _tick: async function () {
        try {
            this._assertConfigured();
            const todoItems = await this._fetchTodoItems();
            const items = await this._enrich(todoItems);
            this._pruneCache(todoItems);
            this._saveCache();
            this.sendSocketNotification("MMPT_ITEMS", {
                items,
                generatedAt: new Date().toISOString()
            });
        } catch (err) {
            Log.warn("[MMM-Package-Tracker] tick failed:", err.message);
            this.sendSocketNotification("MMPT_ERROR", err.userMessage || String(err.message || err));
        }
    },

    _assertConfigured: function () {
        const c = this.config || {};
        const missing =
            !c.haUrl
            || !c.haToken
            || c.haToken.includes("PLACEHOLDER")
            || !c.todoEntity
            || !c.aftershipApiKey
            || c.aftershipApiKey.includes("PLACEHOLDER");
        if (missing) {
            const e = new Error("not configured");
            e.userMessage = "není nakonfigurováno";
            throw e;
        }
    },

    _fetchTodoItems: async function () {
        const url = this.config.haUrl.replace(/\/$/, "")
            + "/api/services/todo/get_items?return_response=true";
        let res;
        try {
            res = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + this.config.haToken,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ entity_id: this.config.todoEntity })
            });
        } catch (err) {
            const e = new Error("HA unreachable: " + err.message);
            e.userMessage = "chyba HA";
            throw e;
        }
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            const e = new Error(`HA HTTP ${res.status} ${body.slice(0, 120)}`);
            e.userMessage = "chyba HA";
            throw e;
        }
        const obj = await res.json();
        const sr = obj.service_response || {};
        const entityBlock = sr[this.config.todoEntity] || Object.values(sr)[0] || {};
        const items = entityBlock.items || [];
        return items
            .map((it) => ({
                uid: it.uid || null,
                summary: (it.summary || "").trim(),
                description: (it.description || "").trim(),
                status: it.status || "needs_action"
            }))
            .filter((it) => it.status === "needs_action" && it.summary);
    },

    _enrich: async function (todoItems) {
        const out = [];
        for (const it of todoItems) {
            const number = it.summary;
            const label = it.description || it.summary;
            let cached = this.cache[number];

            try {
                if (!cached || !cached.slug) {
                    cached = await this._registerTracking(number);
                } else {
                    cached = await this._refreshTracking(cached.slug, number);
                }
                cached.lastChecked = new Date().toISOString();
                this.cache[number] = cached;
            } catch (err) {
                Log.warn(`[MMM-Package-Tracker] AfterShip ${number}:`, err.message);
                // fall back to whatever is cached; if nothing, mark unknown
                cached = this.cache[number] || { status: "Pending" };
            }

            out.push({
                uid: it.uid,
                trackingNumber: number,
                label,
                slug: cached.slug || null,
                courierName: cached.courierName || null,
                status: cached.status || "Pending",
                expectedDelivery: cached.expectedDelivery || null,
                lastEvent: cached.lastEvent || null,
                lastEventTime: cached.lastEventTime || null
            });
        }
        return out;
    },

    _registerTracking: async function (number) {
        try {
            const obj = await this._aftership("POST", "/trackings", {
                tracking: { tracking_number: number }
            });
            return this._extractTracking(obj);
        } catch (err) {
            // 4022 / 4003: tracking already exists — recover via search
            if (err.aftershipCode === 4022 || err.aftershipCode === 4003) {
                return await this._lookupBySearch(number);
            }
            throw err;
        }
    },

    _refreshTracking: async function (slug, number) {
        const obj = await this._aftership(
            "GET",
            `/trackings/${encodeURIComponent(slug)}/${encodeURIComponent(number)}`
        );
        return this._extractTracking(obj);
    },

    _lookupBySearch: async function (number) {
        const obj = await this._aftership(
            "GET",
            `/trackings?keyword=${encodeURIComponent(number)}`
        );
        const arr = (obj && obj.data && obj.data.trackings) || [];
        const hit = arr.find((t) => t.tracking_number === number) || arr[0];
        if (!hit) {
            const e = new Error("tracking not found after register conflict");
            throw e;
        }
        return this._extractTracking({ data: { tracking: hit } });
    },

    _extractTracking: function (obj) {
        const t = (obj && obj.data && obj.data.tracking) || {};
        const checkpoints = Array.isArray(t.checkpoints) ? t.checkpoints : [];
        const last = checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
        return {
            slug: t.slug || null,
            courierName: t.courier_name || t.slug || null,
            status: t.tag || "Pending",
            expectedDelivery: t.expected_delivery || null,
            lastEvent: last ? (last.message || last.subtag_message || null) : null,
            lastEventTime: last ? (last.checkpoint_time || null) : null
        };
    },

    _aftership: async function (method, pathSuffix, body) {
        const url = AFTERSHIP_BASE + pathSuffix;
        let res;
        try {
            res = await fetch(url, {
                method,
                headers: {
                    "aftership-api-key": this.config.aftershipApiKey,
                    "Content-Type": "application/json"
                },
                body: body ? JSON.stringify(body) : undefined
            });
        } catch (err) {
            const e = new Error("AfterShip unreachable: " + err.message);
            e.userMessage = "chyba AfterShip";
            throw e;
        }
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON */ }
        if (!res.ok) {
            const code = json && json.meta && json.meta.code;
            const msg = (json && json.meta && json.meta.message) || text.slice(0, 160);
            const e = new Error(`AfterShip HTTP ${res.status} (${code}): ${msg}`);
            e.aftershipCode = code;
            throw e;
        }
        return json;
    },

    _loadCache: function () {
        try {
            const raw = fs.readFileSync(this.cachePath, "utf8");
            this.cache = JSON.parse(raw) || {};
        } catch (err) {
            if (err.code !== "ENOENT") {
                Log.warn("[MMM-Package-Tracker] cache load failed:", err.message);
            }
            this.cache = {};
        }
    },

    _saveCache: function () {
        try {
            const tmp = this.cachePath + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2));
            fs.renameSync(tmp, this.cachePath);
        } catch (err) {
            Log.warn("[MMM-Package-Tracker] cache save failed:", err.message);
        }
    },

    _pruneCache: function (todoItems) {
        const active = new Set(todoItems.map((it) => it.summary));
        const cutoffMs = (this.config.pruneAfterDays || 14) * 86400000;
        const now = Date.now();
        for (const number of Object.keys(this.cache)) {
            if (active.has(number)) continue;
            const lastChecked = Date.parse(this.cache[number].lastChecked || 0);
            if (!lastChecked || now - lastChecked > cutoffMs) {
                delete this.cache[number];
            }
        }
    }
});
