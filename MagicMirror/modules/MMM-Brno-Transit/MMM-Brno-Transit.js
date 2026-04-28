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
        this._scheduleUiTick();
        this.sendSocketNotification("MMBT_INIT", this.config);
    },

    suspend: function () {
        if (this.uiTick) { clearInterval(this.uiTick); this.uiTick = null; }
        if (this.uiTimeout) { clearTimeout(this.uiTimeout); this.uiTimeout = null; }
    },

    resume: function () {
        this._scheduleUiTick();
    },

    // Re-render every 30 s aligned to wall-clock :00 / :30 boundaries, so the
    // "X min" countdown ticks down on real second-of-minute marks rather than
    // wherever the module happened to start.
    _scheduleUiTick: function () {
        if (this.uiTick) { clearInterval(this.uiTick); this.uiTick = null; }
        if (this.uiTimeout) { clearTimeout(this.uiTimeout); this.uiTimeout = null; }
        const ms = (30000 - (Date.now() % 30000)) % 30000;
        this.uiTimeout = setTimeout(() => {
            this.updateDom();
            this.uiTick = setInterval(() => this.updateDom(), 30 * 1000);
        }, ms || 30000);
    },

    // We render the header ourselves inside getDom() so we can place a single
    // pulsing live-status dot next to the stop name (only when realtime data
    // is currently flowing for at least one displayed departure).
    getHeader: function () {
        return undefined;
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

        wrap.appendChild(this._headerRow());

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

    _headerRow: function () {
        const header = document.createElement("div");
        header.className = "mmbt-header";

        const title = document.createElement("span");
        title.className = "mmbt-title";
        title.textContent = this.config.header || this.config.stopName;
        header.appendChild(title);

        const isLive = !!(this.payload && this.payload.departures
            && this.payload.departures.some(d => d.items && d.items.some(it => it.realtime)));
        if (isLive) {
            const dot = document.createElement("span");
            dot.className = "mmbt-header-dot";
            header.appendChild(dot);
        }
        return header;
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
            // Skip departures that round to "0 min" (i.e. already happened or
            // <30 s away) — user wants to always see the upcoming one.
            const visible = dep.items.filter((it) => {
                const diffSec = Math.max(0, Math.round((it.arrivalMs - Date.now()) / 1000));
                return Math.round(diffSec / 60) > 0;
            }).slice(0, this.config.perLine);

            if (visible.length === 0) {
                const empty = document.createElement("span");
                empty.className = "mmbt-empty";
                empty.textContent = "— mimo provoz";
                times.appendChild(empty);
            } else for (const it of visible) {
                const t = document.createElement("span");
                t.className = "mmbt-time" + (it.realtime ? " mmbt-rt" : "");
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
