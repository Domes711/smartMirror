/* MMM-Brno-Transit
 *
 * Frontend. Sends config to node_helper on start, renders the departure
 * list it gets back. Mode (tram/bus/trolleybus/rail) is auto-derived from
 * GTFS route_type by the helper -- it doesn't appear in user config.
 */

Module.register("MMM-Brno-Transit", {
    defaults: {
        header: undefined,                       // overrides stopName as title
        stopName: "",
        stopId: undefined,                       // optional GTFS stop_id override
        gtfsUrl: "FILL_IN_FROM_DATA_BRNO_CZ",
        gtfsRefreshHours: 168,                   // 1 week
        refreshSec: 60,
        perLine: 2,
        minutesThreshold: 60,                    // <= -> "X min", > -> "HH:MM"
        realtimeUrl: undefined,                  // helper falls back to the default
        vehicleTtlSec: 60,                       // drop stale vehicles
        lines: []                                // [{ line, directionId }]
    },

    start: function () {
        this.payload = null;
        this.errorMsg = null;
        // Re-render every 30 s so "X min" labels stay fresh between helper updates.
        this.uiTick = setInterval(() => this.updateDom(), 30 * 1000);
        this.sendSocketNotification("MMBT_INIT", this.config);
    },

    suspend: function () {
        if (this.uiTick) { clearInterval(this.uiTick); this.uiTick = null; }
    },

    resume: function () {
        if (!this.uiTick) {
            this.uiTick = setInterval(() => this.updateDom(), 30 * 1000);
        }
    },

    getHeader: function () {
        return this.config.header || this.config.stopName;
    },

    getStyles: function () {
        return ["MMM-Brno-Transit.css", "font-awesome.css"];
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMBT_DEPARTURES") {
            this.payload = payload;
            this.errorMsg = null;
            this.updateDom();
        } else if (notification === "MMBT_ERROR") {
            this.errorMsg = payload;
            this.updateDom();
        }
    },

    getDom: function () {
        const wrap = document.createElement("div");
        wrap.className = "mmbt";

        if (this.errorMsg) {
            wrap.appendChild(this._statusRow(this.errorMsg));
            return wrap;
        }
        if (!this.payload) {
            wrap.appendChild(this._statusRow("načítání…"));
            return wrap;
        }
        for (const dep of this.payload.departures) {
            wrap.appendChild(this._lineRow(dep));
        }
        return wrap;
    },

    _lineRow: function (dep) {
        const row = document.createElement("div");
        row.className = "mmbt-row";

        const icon = document.createElement("span");
        icon.className = "mmbt-icon";
        icon.innerHTML = `<i class="${this._iconClass(dep.mode)}"></i>`;
        row.appendChild(icon);

        const num = document.createElement("span");
        num.className = "mmbt-line";
        num.textContent = dep.line;
        row.appendChild(num);

        const times = document.createElement("span");
        times.className = "mmbt-times";

        if (dep.note) {
            const empty = document.createElement("span");
            empty.className = "mmbt-empty";
            empty.textContent = "— " + dep.note;
            times.appendChild(empty);
        } else if (!dep.items || dep.items.length === 0) {
            const empty = document.createElement("span");
            empty.className = "mmbt-empty";
            empty.textContent = "— mimo provoz";
            times.appendChild(empty);
        } else {
            for (const it of dep.items) {
                const t = document.createElement("span");
                t.className = "mmbt-time" + (it.realtime ? " mmbt-rt" : "");
                if (it.realtime) {
                    const dot = document.createElement("span");
                    dot.className = "mmbt-dot";
                    t.appendChild(dot);
                }
                t.appendChild(document.createTextNode(this._formatTime(it)));
                if (it.realtime && typeof it.delayMin === "number" && it.delayMin !== 0) {
                    t.title = `scheduled ${it.scheduledHm || "?"} · delay ${it.delayMin > 0 ? "+" : ""}${it.delayMin} min`;
                }
                times.appendChild(t);
            }
        }
        row.appendChild(times);
        return row;
    },

    _statusRow: function (text) {
        const row = document.createElement("div");
        row.className = "mmbt-row mmbt-status";
        const t = document.createElement("span");
        t.className = "mmbt-empty";
        t.textContent = text;
        row.appendChild(t);
        return row;
    },

    _formatTime: function (it) {
        // Compute the live countdown from the absolute arrival time each
        // render, so ticks between helper updates still tick down smoothly
        // and any delay change from the stream is reflected immediately
        // after the next helper tick.
        const diffSec = Math.max(0, Math.round((it.arrivalMs - Date.now()) / 1000));
        const min = Math.round(diffSec / 60);
        if (min <= this.config.minutesThreshold) return `${min} min`;
        return it.displayHm;
    },

    _iconClass: function (mode) {
        switch (mode) {
            case "tram":        return "fa-solid fa-train-tram";
            case "bus":         return "fa-solid fa-bus";
            case "trolleybus":  return "fa-solid fa-bus-simple";
            case "rail":        return "fa-solid fa-train";
            case "subway":      return "fa-solid fa-train-subway";
            case "ferry":       return "fa-solid fa-ship";
            default:            return "fa-solid fa-bus";
        }
    }
});
