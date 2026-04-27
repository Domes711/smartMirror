/* MMM-Package-Tracker — node_helper
 *
 * Polls a Home Assistant todo list of tracking numbers, enriches each
 * with carrier + status from AfterShip, and pushes the result to the
 * frontend. Cache on disk so we don't re-register tracking numbers on
 * every restart. AfterShip enrichment + cache land in Task 5.
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
            const items = todoItems.map((it) => ({
                uid: it.uid,
                trackingNumber: it.summary,
                label: it.description || it.summary
            }));
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
    }
});
