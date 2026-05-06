/* MMM-Spending — node_helper
 *
 * Polls Wallet by BudgetBakers REST API for today's records, filters
 * to personal expense rows (configured accounts, excluding transfers),
 * sums them, and pushes the result + last few items to the frontend.
 *
 * API contract verified 2026-04-27:
 *   GET https://rest.budgetbakers.com/wallet/v1/api/records
 *       ?recordDate=gte.<ISO8601 UTC>&limit=200
 *   Authorization: Bearer <JWT>
 *   Response: { records: [{ accountId, amount: { value, currencyCode },
 *               recordDate, recordType, category: { envelopeId } , ... }] }
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
        if (notification === "MMSP_INIT") {
            this.config = payload;
            if (this.timer) clearInterval(this.timer);
            this._tick();
            this.timer = setInterval(
                () => this._tick(),
                Math.max(60, this.config.refreshSec || 300) * 1000
            );
        } else if (notification === "MMSP_REFRESH") {
            this._tick();
        }
    },

    _tick: async function () {
        try {
            const data = await this._fetchAndAggregate();
            this.sendSocketNotification("MMSP_DATA", data);
        } catch (err) {
            Log.warn("[MMM-Spending] fetch failed:", err.message);
            this.sendSocketNotification("MMSP_ERROR", String(err.message || err));
        }
    },

    _fetchAndAggregate: async function () {
        const cfg = this.config || {};
        if (!cfg.apiToken || cfg.apiToken.includes("PLACEHOLDER")) {
            throw new Error("apiToken not configured");
        }

        const startMillis = this._localMidnightMillis(cfg.timezone || "Europe/Prague");
        const startIso = new Date(startMillis).toISOString();
        const apiBase = (cfg.apiBase || "https://rest.budgetbakers.com/wallet/v1/api")
            .replace(/\/$/, "");
        const url = `${apiBase}/records`
            + `?recordDate=gte.${encodeURIComponent(startIso)}`
            + `&limit=200`;

        const res = await fetch(url, {
            headers: {
                "Authorization": "Bearer " + cfg.apiToken,
                "Accept": "application/json"
            }
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Wallet HTTP ${res.status} ${body.slice(0, 120)}`);
        }
        const json = await res.json();
        const records = Array.isArray(json.records) ? json.records : [];

        const includeAccounts = new Set(cfg.includeAccountIds || []);
        const excludeEnvs = new Set(cfg.excludeEnvelopeIds || [20001]);
        const filterByAccount = includeAccounts.size > 0;

        const filtered = records.filter((r) => {
            if (!r || r.recordType !== "expense") return false;
            if (filterByAccount && !includeAccounts.has(r.accountId)) return false;
            const env = r.category && r.category.envelopeId;
            if (env != null && excludeEnvs.has(env)) return false;
            // Re-check client-side against local-midnight; server uses UTC
            const ts = Date.parse(r.recordDate);
            if (Number.isNaN(ts) || ts < startMillis) return false;
            return true;
        });

        // Pick the dominant currency by record count
        const currencyCounts = {};
        for (const r of filtered) {
            const c = (r.amount && r.amount.currencyCode) || cfg.currency || "CZK";
            currencyCounts[c] = (currencyCounts[c] || 0) + 1;
        }
        const dominantCurrency = Object.keys(currencyCounts).sort(
            (a, b) => currencyCounts[b] - currencyCounts[a]
        )[0] || cfg.currency || "CZK";

        // Sum |amount.value| of records in dominant currency only
        const total = filtered
            .filter((r) => (r.amount && r.amount.currencyCode) === dominantCurrency)
            .reduce((s, r) => s + Math.abs((r.amount && r.amount.value) || 0), 0);

        const recent = filtered
            .slice()
            .sort((a, b) => Date.parse(b.recordDate) - Date.parse(a.recordDate))
            .slice(0, Math.max(0, cfg.recentCount || 3))
            .map((r) => ({
                payee: r.payee || r.payer || "—",
                amount: Math.abs((r.amount && r.amount.value) || 0),
                currency: (r.amount && r.amount.currencyCode) || dominantCurrency
            }));

        return {
            total,
            currency: dominantCurrency,
            count: filtered.length,
            recent,
            generatedAt: new Date().toISOString()
        };
    },

    /**
     * Returns the epoch-millis of the most recent midnight in the given
     * IANA timezone. Uses the en-CA Intl format which yields ISO date.
     */
    _localMidnightMillis: function (timeZone) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone, year: "numeric", month: "2-digit", day: "2-digit"
        }).formatToParts(new Date());
        const get = (t) => parts.find((p) => p.type === t).value;
        const ymd = `${get("year")}-${get("month")}-${get("day")}T00:00:00`;
        // Treat ymd as wall-clock in `timeZone` and convert to UTC millis.
        // Trick: build a UTC Date from the Y-M-D, then offset by the
        // timezone's current offset (minutes).
        const asUtc = Date.parse(ymd + "Z");
        const tzOffsetMin = this._tzOffsetMinutes(timeZone, asUtc);
        return asUtc - tzOffsetMin * 60 * 1000;
    },

    _tzOffsetMinutes: function (timeZone, atMillis) {
        // Format the same instant in the target zone and in UTC, diff them.
        const fmt = (tz) => new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hour12: false
        }).format(new Date(atMillis));
        const toMin = (s) => {
            // "2026-04-27, 12:30"
            const m = s.match(/(\d{4})-(\d{2})-(\d{2}),?\s+(\d{2}):(\d{2})/);
            if (!m) return 0;
            const d = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
            return d / 60000;
        };
        return toMin(fmt(timeZone)) - toMin(fmt("UTC"));
    }
});
