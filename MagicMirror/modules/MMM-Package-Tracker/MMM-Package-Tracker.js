/* MMM-Package-Tracker
 *
 * Frontend: renders inbound packages whose tracking numbers come from a
 * Home Assistant todo list and whose courier/status come from AfterShip.
 * Two-line rows: label + status badge / courier + ETA-or-event. Sorting
 * pushes "out for delivery" first, then in-transit, warnings, others.
 */

const MMPT_STATUS_ORDER = [
    "OutForDelivery",
    "InTransit",
    "InfoReceived",
    "AvailableForPickup",
    "AttemptFail",
    "Exception",
    "Expired",
    "Pending",
    "Delivered"
];

const MMPT_STATUS_LABELS_CS = {
    Pending: "čeká na převzetí",
    InfoReceived: "čeká na převzetí",
    InTransit: "na cestě",
    OutForDelivery: "v doručování",
    AvailableForPickup: "připraveno k vyzvednutí",
    AttemptFail: "nezastiženo",
    Exception: "problém",
    Expired: "problém",
    Delivered: "doručeno"
};

const MMPT_STATUS_LABELS_EN = {
    Pending: "pending",
    InfoReceived: "pending",
    InTransit: "in transit",
    OutForDelivery: "out for delivery",
    AvailableForPickup: "ready for pickup",
    AttemptFail: "delivery attempted",
    Exception: "issue",
    Expired: "issue",
    Delivered: "delivered"
};

const MMPT_STATUS_CLASS = {
    Pending: "mmpt-pending",
    InfoReceived: "mmpt-pending",
    InTransit: "mmpt-transit",
    OutForDelivery: "mmpt-out",
    AvailableForPickup: "mmpt-pickup",
    AttemptFail: "mmpt-warn",
    Exception: "mmpt-warn",
    Expired: "mmpt-warn",
    Delivered: "mmpt-done"
};

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

        const sorted = this.items.slice().sort((a, b) => {
            const ai = MMPT_STATUS_ORDER.indexOf(a.status);
            const bi = MMPT_STATUS_ORDER.indexOf(b.status);
            const av = ai === -1 ? MMPT_STATUS_ORDER.length : ai;
            const bv = bi === -1 ? MMPT_STATUS_ORDER.length : bi;
            if (av !== bv) return av - bv;
            const ad = a.expectedDelivery ? Date.parse(a.expectedDelivery) : Infinity;
            const bd = b.expectedDelivery ? Date.parse(b.expectedDelivery) : Infinity;
            if (ad !== bd) return ad - bd;
            return (a.label || "").localeCompare(b.label || "");
        });

        const list = sorted.slice(0, this.config.maxItems);
        if (list.length === 0) {
            wrap.appendChild(this._statusRow("— žádné balíky"));
            return wrap;
        }

        for (const item of list) wrap.appendChild(this._itemRow(item));
        return wrap;
    },

    _itemRow: function (item) {
        const row = document.createElement("div");
        row.className = "mmpt-row";
        const statusClass = MMPT_STATUS_CLASS[item.status] || "mmpt-pending";
        row.classList.add(statusClass);

        const icon = document.createElement("span");
        icon.className = "mmpt-icon";
        icon.innerHTML = this._statusIcon(item.status);
        row.appendChild(icon);

        const body = document.createElement("div");
        body.className = "mmpt-body";

        const titleLine = document.createElement("div");
        titleLine.className = "mmpt-title-row";

        const title = document.createElement("span");
        title.className = "mmpt-title";
        title.textContent = item.label || item.trackingNumber || "—";
        titleLine.appendChild(title);

        const badge = document.createElement("span");
        badge.className = "mmpt-badge";
        badge.textContent = this._statusLabel(item.status);
        titleLine.appendChild(badge);

        body.appendChild(titleLine);

        const meta = this._metaText(item);
        if (meta) {
            const metaEl = document.createElement("div");
            metaEl.className = "mmpt-meta";
            metaEl.textContent = meta;
            body.appendChild(metaEl);
        }

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
    },

    _metaText: function (item) {
        const parts = [];
        if (item.courierName) parts.push(item.courierName);
        const eta = this._formatEta(item.expectedDelivery);
        if (eta) {
            parts.push(this._lang("expectedPrefix") + " " + eta);
        } else if (item.lastEvent) {
            parts.push(item.lastEvent);
        }
        return parts.join(" · ");
    },

    _statusLabel: function (status) {
        const dict = this.config.language === "cs"
            ? MMPT_STATUS_LABELS_CS
            : MMPT_STATUS_LABELS_EN;
        return dict[status] || dict.Pending;
    },

    _statusIcon: function (status) {
        switch (status) {
            case "OutForDelivery":
                return '<i class="fa-solid fa-truck-fast"></i>';
            case "InTransit":
            case "InfoReceived":
                return '<i class="fa-solid fa-box"></i>';
            case "AvailableForPickup":
                return '<i class="fa-solid fa-location-dot"></i>';
            case "AttemptFail":
            case "Exception":
            case "Expired":
                return '<i class="fa-solid fa-triangle-exclamation"></i>';
            case "Delivered":
                return '<i class="fa-solid fa-circle-check"></i>';
            default:
                return '<i class="fa-regular fa-clock"></i>';
        }
    },

    _formatEta: function (due) {
        if (!due) return null;
        const d = new Date(due);
        if (isNaN(d)) return null;
        const isDatetime = /T\d/.test(due);
        const locale = this.config.language === "cs" ? "cs-CZ" : "en-GB";

        const now = new Date();
        const dayMs = 86400000;
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diffDays = Math.round((dueDay - today) / dayMs);

        let datePart;
        if (diffDays === 0) datePart = this._lang("today");
        else if (diffDays === 1) datePart = this._lang("tomorrow");
        else if (diffDays === -1) datePart = this._lang("yesterday");
        else if (diffDays > 1 && diffDays < 7) {
            datePart = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(d);
        } else {
            datePart = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" }).format(d);
        }

        if (!isDatetime) return datePart;
        const timePart = new Intl.DateTimeFormat(locale, {
            hour: "2-digit", minute: "2-digit"
        }).format(d);
        return `${datePart} ${timePart}`;
    },

    _lang: function (key) {
        const dict = {
            cs: {
                today: "dnes",
                tomorrow: "zítra",
                yesterday: "včera",
                expectedPrefix: "očekáváno"
            },
            en: {
                today: "today",
                tomorrow: "tomorrow",
                yesterday: "yesterday",
                expectedPrefix: "expected"
            }
        };
        return (dict[this.config.language] || dict.en)[key];
    }
});
