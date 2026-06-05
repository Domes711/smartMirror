/* node_helper.js — fetches & resolves restaurants for MMM-Lunch-Menu.
 *
 * Modes (no flag — content decides):
 *   config.restaurants non-empty → scrape those (first `count`).
 *   else                         → scrape `city` page, geocode candidate
 *                                  addresses (Nominatim, cached), pick the
 *                                  nearest `count` to config.location.
 */
const NodeHelper = require("node_helper");
const Log = require("logger");
const fs = require("fs");
const path = require("path");
const P = require("./lunch-parser");

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

module.exports = NodeHelper.create({
  start() {
    this.config = null;
    this.timer = null;
    this.geocache = this._loadCache();
    this.lastGeocodeAt = 0;
    Log.info("[MMM-Lunch-Menu] node_helper started");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "LUNCH_INIT") {
      this.config = payload || {};
      this._scheduleAndRun();
    }
  },

  _scheduleAndRun() {
    if (this.timer) clearInterval(this.timer);
    const run = () => this._update().catch((e) =>
      Log.error("[MMM-Lunch-Menu] update failed:", e && e.message));
    run();
    const ms = Math.max(5 * 60 * 1000, this.config.updateInterval || 3600000);
    this.timer = setInterval(run, ms);
  },

  // --- HTTP -----------------------------------------------------------------
  async _fetch(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "User-Agent": this.config.userAgent || "MMM-Lunch-Menu (smart mirror)" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.text();
    } finally {
      clearTimeout(t);
    }
  },

  // --- geocode (Nominatim + persistent cache, ≤1 req/s) ---------------------
  _cachePath() {
    return path.join(__dirname, "geocode-cache.json");
  },
  _loadCache() {
    try {
      return JSON.parse(fs.readFileSync(this._cachePath(), "utf8"));
    } catch {
      return {};
    }
  },
  _saveCache() {
    try {
      fs.writeFileSync(this._cachePath(), JSON.stringify(this.geocache, null, 2));
    } catch (e) {
      Log.warn("[MMM-Lunch-Menu] geocache save failed:", e && e.message);
    }
  },
  async _geocode(address) {
    if (!address) return null;
    if (this.geocache[address] !== undefined) return this.geocache[address];
    // throttle: Nominatim asks for ≤1 request/second
    const wait = 1100 - (Date.now() - this.lastGeocodeAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastGeocodeAt = Date.now();
    let result = null;
    try {
      const url = `${NOMINATIM}?format=json&limit=1&countrycodes=cz&q=${encodeURIComponent(address)}`;
      const r = await fetch(url, {
        headers: { "User-Agent": this.config.userAgent || "MMM-Lunch-Menu (smart mirror)" },
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j[0]) result = { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) };
      }
    } catch (e) {
      Log.warn("[MMM-Lunch-Menu] geocode failed:", e && e.message);
    }
    this.geocache[address] = result; // cache null too (avoid re-querying misses)
    this._saveCache();
    return result;
  },

  // --- resolve + scrape -----------------------------------------------------
  async _resolveByList() {
    const urls = (this.config.restaurants || [])
      .slice(0, this.config.count || 4)
      .map((e) => P.restaurantUrl(e));
    return Promise.all(urls.map((u) => this._scrapeRestaurant(u)));
  },

  async _resolveByLocation() {
    const loc = this.config.location;
    if (!loc || typeof loc.lat !== "number") {
      return [{ error: "NO_LOCATION" }]; // translation key (frontend translates)
    }
    const city = this.config.city || "brno";
    const cityHtml = await this._fetch(`${P.BASE}/${city}.html`);
    const pool = P.parseCityCandidates(cityHtml).slice(0, this.config.nearbyPool || 20);

    // fetch + parse each candidate (gives name, address, today's menu)
    const parsed = [];
    for (const c of pool) {
      try {
        const html = await this._fetch(c.url);
        const m = P.parseRestaurantPage(html, { now: new Date() });
        if (m.address) {
          const geo = await this._geocode(m.address);
          if (geo) parsed.push({ ...m, url: c.url, dist: P.haversineKm(loc, geo) });
        }
      } catch (e) {
        Log.warn("[MMM-Lunch-Menu] candidate failed:", c.url, e && e.message);
      }
    }
    parsed.sort((a, b) => a.dist - b.dist);
    return parsed.slice(0, this.config.count || 4);
  },

  async _scrapeRestaurant(url) {
    try {
      const html = await this._fetch(url);
      const m = P.parseRestaurantPage(html, { now: new Date() });
      if (!m.name) Log.warn("[MMM-Lunch-Menu] no name parsed for", url);
      return { ...m, url };
    } catch (e) {
      Log.error("[MMM-Lunch-Menu] scrape failed:", url, e && e.message);
      return { url, error: "UNAVAILABLE" }; // translation key (frontend translates)
    }
  },

  async _update() {
    if (!this.config) return;
    const byList = (this.config.restaurants || []).length > 0;
    const restaurants = byList
      ? await this._resolveByList()
      : await this._resolveByLocation();
    this.sendSocketNotification("LUNCH_MENU", {
      restaurants,
      updatedAt: Date.now(),
    });
  },
});
