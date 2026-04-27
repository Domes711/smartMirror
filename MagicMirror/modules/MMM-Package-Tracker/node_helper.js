/* MMM-Package-Tracker — node_helper
 *
 * Polls a Home Assistant todo list of tracking numbers, enriches each
 * with carrier + status from AfterShip, and pushes the result to the
 * frontend. Cache on disk so we don't re-register tracking numbers on
 * every restart. Filled in across Tasks 4–7 of the implementation plan.
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
            // Tasks 4–7 will fill this in.
            this.sendSocketNotification("MMPT_ITEMS", {
                items: [],
                generatedAt: new Date().toISOString()
            });
        } catch (err) {
            Log.warn("[MMM-Package-Tracker] tick failed:", err.message);
            this.sendSocketNotification("MMPT_ERROR", String(err.message || err));
        }
    }
});
