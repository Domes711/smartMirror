/* MMM-HA-Reminders — node_helper
 *
 * Polls one or more Home Assistant `todo.*` entities via REST and pushes
 * their items to the frontend. Uses the `todo.get_items` service with
 * return_response=true, since `todo` entities do NOT expose items via
 * /api/states (items are tracked separately in HA since the 2023.11
 * todo platform).
 */

const NodeHelper = require("node_helper");
const Log = require("logger");

module.exports = NodeHelper.create({

    start: function () {
        this.config = null;
        this.timer = null;
    },

    stop: function () {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMHAR_INIT") {
            this.config = payload;
            if (this.timer) clearInterval(this.timer);
            this._tick();
            this.timer = setInterval(
                () => this._tick(),
                (this.config.refreshSec || 60) * 1000
            );
        }
    },

    _tick: async function () {
        try {
            const items = await this._fetchAll();
            this.sendSocketNotification("MMHAR_ITEMS", {
                items,
                generatedAt: new Date().toISOString()
            });
        } catch (err) {
            Log.warn("[MMM-HA-Reminders] fetch failed:", err.message);
            this.sendSocketNotification("MMHAR_ERROR", String(err.message || err));
        }
    },

    _fetchAll: async function () {
        if (!this.config.haUrl || !this.config.haToken
            || this.config.haToken.includes("PLACEHOLDER")) {
            throw new Error("haUrl / haToken not configured");
        }
        const entities = (this.config.todoEntities || []).filter(Boolean);
        if (!entities.length) throw new Error("todoEntities is empty");

        const all = [];
        for (const entityId of entities) {
            const items = await this._fetchOne(entityId);
            for (const it of items) {
                all.push({ ...it, entityId });
            }
        }
        return all;
    },

    _fetchOne: async function (entityId) {
        const url = this.config.haUrl.replace(/\/$/, "")
            + "/api/services/todo/get_items?return_response=true";
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + this.config.haToken,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ entity_id: entityId })
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`HA ${entityId} HTTP ${res.status} ${body.slice(0, 120)}`);
        }
        const obj = await res.json();
        // HA responds with { service_response: { <entity_id>: { items: [...] } } }
        const sr = obj.service_response || {};
        const entityBlock = sr[entityId] || Object.values(sr)[0] || {};
        const items = entityBlock.items || [];
        return items.map((it) => ({
            uid: it.uid || null,
            summary: it.summary || "",
            status: it.status || "needs_action",       // needs_action | completed
            due: it.due || null,                        // ISO date or null
            description: it.description || ""
        }));
    }
});
