/* MMM-Package-Tracker
 *
 * Frontend: renders inbound packages whose tracking numbers come from a
 * Home Assistant todo list and whose courier/status come from AfterShip.
 * Filled in across Tasks 4–7 of the implementation plan.
 */

Module.register("MMM-Package-Tracker", {
    defaults: {
        header: "Balíky",
        haUrl: "",
        haToken: "HA_TOKEN_PLACEHOLDER",
        todoEntity: "todo.balicky",
        aftershipApiKey: "AFTERSHIP_KEY_PLACEHOLDER",
        refreshSec: 1800,
        maxItems: 6,
        autoCompleteOnDelivered: true,
        pruneAfterDays: 14,
        language: "cs"
    },

    start: function () {
        this.items = null;
        this.errorMsg = null;
        this.uiTick = setInterval(() => this.updateDom(), 60 * 1000);
        this.sendSocketNotification("MMPT_INIT", this.config);
    },

    suspend: function () {
        if (this.uiTick) { clearInterval(this.uiTick); this.uiTick = null; }
    },
    resume: function () {
        if (!this.uiTick) {
            this.uiTick = setInterval(() => this.updateDom(), 60 * 1000);
        }
    },

    getHeader: function () {
        return this.config.header;
    },

    getStyles: function () {
        return ["MMM-Package-Tracker.css", "font-awesome.css"];
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMPT_ITEMS") {
            this.items = payload.items;
            this.errorMsg = null;
            this.updateDom();
        } else if (notification === "MMPT_ERROR") {
            this.errorMsg = payload;
            this.updateDom();
        }
    },

    getDom: function () {
        const wrap = document.createElement("div");
        wrap.className = "mmpt";

        if (this.errorMsg) {
            wrap.appendChild(this._statusRow(this.errorMsg));
            return wrap;
        }
        if (this.items === null) {
            wrap.appendChild(this._statusRow("načítání…"));
            return wrap;
        }
        if (this.items.length === 0) {
            wrap.appendChild(this._statusRow("— žádné balíky"));
            return wrap;
        }

        const list = this.items.slice(0, this.config.maxItems);
        for (const item of list) wrap.appendChild(this._itemRow(item));
        return wrap;
    },

    _itemRow: function (item) {
        const row = document.createElement("div");
        row.className = "mmpt-row";
        const body = document.createElement("div");
        body.className = "mmpt-body";
        const title = document.createElement("div");
        title.className = "mmpt-title";
        title.textContent = item.label || item.trackingNumber || "—";
        body.appendChild(title);
        row.appendChild(body);
        return row;
    },

    _statusRow: function (text) {
        const row = document.createElement("div");
        row.className = "mmpt-row mmpt-status";
        const t = document.createElement("span");
        t.className = "mmpt-empty";
        t.textContent = text;
        row.appendChild(t);
        return row;
    }
});
