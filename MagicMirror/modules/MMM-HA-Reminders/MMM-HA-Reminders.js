/* MMM-HA-Reminders
 *
 * Frontend: renders a list of reminders pulled by node_helper from
 * Home Assistant's todo domain. Open items first, sorted by due date,
 * optional due date label in relative form (today/tomorrow/weekday).
 */

Module.register("MMM-HA-Reminders", {
    defaults: {
        header: "Reminders",
        haUrl: "",
        haToken: "HA_TOKEN_PLACEHOLDER",
        todoEntities: [],                // e.g. ["todo.iphone_reminders"]
        maxItems: 6,
        showDueDate: true,
        showCompleted: false,
        refreshSec: 60,
        language: "cs"                   // "cs" | "en"
    },

    start: function () {
        this.items = null;
        this.errorMsg = null;
        this.uiTick = setInterval(() => this.updateDom(), 60 * 1000);
        this.sendSocketNotification("MMHAR_INIT", this.config);
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
        return ["MMM-HA-Reminders.css", "font-awesome.css"];
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMHAR_ITEMS") {
            this.items = payload.items;
            this.errorMsg = null;
            this.updateDom();
        } else if (notification === "MMHAR_ERROR") {
            this.errorMsg = payload;
            this.updateDom();
        }
    },

    getDom: function () {
        const wrap = document.createElement("div");
        wrap.className = "mmhar";

        if (this.errorMsg) {
            wrap.appendChild(this._statusRow(this.errorMsg));
            return wrap;
        }
        if (this.items === null) {
            wrap.appendChild(this._statusRow("načítání…"));
            return wrap;
        }

        let list = this.items.slice();
        if (!this.config.showCompleted) {
            list = list.filter((i) => i.status !== "completed");
        }
        list.sort((a, b) => {
            // completed last
            const ac = a.status === "completed" ? 1 : 0;
            const bc = b.status === "completed" ? 1 : 0;
            if (ac !== bc) return ac - bc;
            // due ascending, null last
            const ad = a.due ? Date.parse(a.due) : Infinity;
            const bd = b.due ? Date.parse(b.due) : Infinity;
            if (ad !== bd) return ad - bd;
            return (a.summary || "").localeCompare(b.summary || "");
        });
        list = list.slice(0, this.config.maxItems);

        if (list.length === 0) {
            wrap.appendChild(this._statusRow("— žádné úkoly"));
            return wrap;
        }

        for (const item of list) wrap.appendChild(this._itemRow(item));
        return wrap;
    },

    _itemRow: function (item) {
        const row = document.createElement("div");
        row.className = "mmhar-row";
        if (item.status === "completed") row.classList.add("mmhar-done");

        const icon = document.createElement("span");
        icon.className = "mmhar-icon";
        icon.innerHTML = item.status === "completed"
            ? '<i class="fa-regular fa-circle-check"></i>'
            : '<i class="fa-regular fa-circle"></i>';
        row.appendChild(icon);

        const body = document.createElement("div");
        body.className = "mmhar-body";

        const title = document.createElement("div");
        title.className = "mmhar-title";
        title.textContent = item.summary;
        body.appendChild(title);

        if (this.config.showDueDate && item.due) {
            const due = document.createElement("div");
            due.className = "mmhar-due";
            const label = this._formatDue(item.due);
            if (label) {
                due.textContent = label;
                if (this._isOverdue(item.due)) due.classList.add("mmhar-overdue");
                body.appendChild(due);
            }
        }

        row.appendChild(body);
        return row;
    },

    _statusRow: function (text) {
        const row = document.createElement("div");
        row.className = "mmhar-row mmhar-status";
        const t = document.createElement("span");
        t.className = "mmhar-empty";
        t.textContent = text;
        row.appendChild(t);
        return row;
    },

    _isOverdue: function (due) {
        return Date.parse(due) < Date.now();
    },

    _formatDue: function (due) {
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
        else if (diffDays > 0 && diffDays < 7) {
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
            cs: { today: "dnes", tomorrow: "zítra", yesterday: "včera" },
            en: { today: "today", tomorrow: "tomorrow", yesterday: "yesterday" }
        };
        return (dict[this.config.language] || dict.en)[key];
    }
});
