/* MMM-Spending
 *
 * Frontend: shows today's personal spending pulled by node_helper from
 * the Wallet by BudgetBakers REST API. Three lines: big total amount,
 * transaction count, and a short list of the most recent items.
 */

Module.register("MMM-Spending", {
    defaults: {
        header: "Útrata dnes",
        apiToken: "BB_TOKEN_PLACEHOLDER",
        apiBase: "https://rest.budgetbakers.com/wallet/v1/api",
        includeAccountIds: [],          // e.g. ["ae93...","c989..."]; empty = all
        excludeEnvelopeIds: [20001],    // 20001 = Převod (inter-account transfer)
        currency: "CZK",
        timezone: "Europe/Prague",
        recentCount: 3,
        refreshSec: 300,
        language: "cs"                  // "cs" | "en"
    },

    start: function () {
        this.data = null;
        this.errorMsg = null;
        this._currentDay = this._localDayKey();
        this.uiTick = setInterval(() => this._onMinute(), 60 * 1000);
        this.sendSocketNotification("MMSP_INIT", this.config);
    },

    suspend: function () {
        if (this.uiTick) { clearInterval(this.uiTick); this.uiTick = null; }
    },
    resume: function () {
        if (!this.uiTick) {
            this.uiTick = setInterval(() => this._onMinute(), 60 * 1000);
        }
    },

    getHeader: function () {
        return this.config.header;
    },

    getStyles: function () {
        return ["MMM-Spending.css"];
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMSP_DATA") {
            this.data = payload;
            this.errorMsg = null;
            this.updateDom();
        } else if (notification === "MMSP_ERROR") {
            this.errorMsg = payload;
            this.updateDom();
        }
    },

    _onMinute: function () {
        const today = this._localDayKey();
        if (today !== this._currentDay) {
            this._currentDay = today;
            this.sendSocketNotification("MMSP_REFRESH");
        }
        // re-render so "naposledy HH:MM" stays current in error states
        this.updateDom();
    },

    _localDayKey: function () {
        const tz = this.config.timezone || "Europe/Prague";
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
        }).format(new Date());
    },

    getDom: function () {
        const wrap = document.createElement("div");
        wrap.className = "mmsp";

        if (this.data === null && !this.errorMsg) {
            wrap.appendChild(this._statusRow("načítání…"));
            return wrap;
        }
        if (this.errorMsg) {
            wrap.appendChild(this._totalRow(
                this.data ? this.data.total : 0,
                this.data ? this.data.currency : this.config.currency
            ));
            wrap.appendChild(this._statusRow("⚠ " + this.errorMsg));
            if (this.data && this.data.generatedAt) {
                wrap.appendChild(this._lastUpdatedRow(this.data.generatedAt));
            }
            return wrap;
        }

        wrap.appendChild(this._totalRow(this.data.total, this.data.currency));
        wrap.appendChild(this._countRow(this.data.count));

        if ((this.data.recent || []).length > 0) {
            wrap.appendChild(this._separator());
            for (const r of this.data.recent) {
                wrap.appendChild(this._recentRow(r));
            }
        }
        return wrap;
    },

    _totalRow: function (amount, currency) {
        const row = document.createElement("div");
        row.className = "mmsp-total";
        row.textContent = this._fmtMoney(amount, currency, 2);
        return row;
    },

    _countRow: function (count) {
        const row = document.createElement("div");
        row.className = "mmsp-count";
        row.textContent = this._fmtCount(count);
        return row;
    },

    _separator: function () {
        const sep = document.createElement("div");
        sep.className = "mmsp-sep";
        return sep;
    },

    _recentRow: function (item) {
        const row = document.createElement("div");
        row.className = "mmsp-recent";

        const name = document.createElement("span");
        name.className = "mmsp-payee";
        name.textContent = this._truncate(item.payee || "—", 22);

        const amt = document.createElement("span");
        amt.className = "mmsp-amount";
        amt.textContent = this._fmtMoney(item.amount, item.currency || this.data.currency, 0);

        row.appendChild(name);
        row.appendChild(amt);
        return row;
    },

    _statusRow: function (text) {
        const row = document.createElement("div");
        row.className = "mmsp-status";
        row.textContent = text;
        return row;
    },

    _lastUpdatedRow: function (iso) {
        const row = document.createElement("div");
        row.className = "mmsp-last";
        const d = new Date(iso);
        const locale = this.config.language === "cs" ? "cs-CZ" : "en-GB";
        const t = new Intl.DateTimeFormat(locale, {
            hour: "2-digit", minute: "2-digit"
        }).format(d);
        row.textContent = (this.config.language === "cs" ? "naposledy " : "last update ") + t;
        return row;
    },

    _fmtMoney: function (value, currency, fractionDigits) {
        const locale = this.config.language === "cs" ? "cs-CZ" : "en-GB";
        try {
            return new Intl.NumberFormat(locale, {
                style: "currency",
                currency: currency || "CZK",
                maximumFractionDigits: fractionDigits,
                minimumFractionDigits: fractionDigits
            }).format(value);
        } catch (e) {
            return value.toFixed(fractionDigits) + " " + (currency || "");
        }
    },

    _fmtCount: function (n) {
        if (this.config.language === "cs") {
            const word = (n === 1) ? "transakce"
                       : (n >= 2 && n <= 4) ? "transakce"
                       : "transakcí";
            return `${n} ${word} dnes`;
        }
        return `${n} transaction${n === 1 ? "" : "s"} today`;
    },

    _truncate: function (s, n) {
        if (!s) return "";
        return s.length > n ? s.slice(0, n - 1) + "…" : s;
    }
});
