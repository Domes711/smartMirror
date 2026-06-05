/* lunch-parser.js — pure menicka.cz HTML parsing (cheerio). No network here, so
 * it is unit-testable against saved HTML fixtures.
 *
 * menicka.cz structure (server-rendered):
 *   div.menicka            → one block per day
 *     div.nadpis           → date heading, e.g. "Pátek 5.6.2026"
 *     ul li                → one row per item
 *       div.polozka        → dish name (incl. "N." prefix + "(allergens)")
 *       div.cena           → price, e.g. "179 Kč"
 *   h1                     → restaurant name (detail page)
 *   .street-address/.locality → address (hCard microformat)
 *   ul#cityroll a          → restaurant links on a city page
 */
const cheerio = require("cheerio");

const BASE = "https://www.menicka.cz";

function ymd(date) {
  return { d: date.getDate(), m: date.getMonth() + 1, y: date.getFullYear() };
}

function absUrl(href) {
  if (!href) return null;
  if (/^https?:\/\//.test(href)) return href;
  return BASE + (href.startsWith("/") ? href : "/" + href);
}

// "5396" | "5396-restaurace-foo" | full URL → detail page URL
function restaurantUrl(entry) {
  const s = String(entry).trim();
  if (/^https?:\/\//.test(s)) return s;
  if (/^\d+$/.test(s)) return `${BASE}/${s}.html`;        // numeric id (menicka 301s to slug)
  return `${BASE}/${s.replace(/\.html$/, "")}.html`;       // id-slug
}

function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/\s/g, "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// "1. Krémové risotto s brokolicí (7)" → {num:1, name, allergens:[7], isSoup:false}
function parseItem(text) {
  let raw = String(text || "").replace(/\s+/g, " ").trim();
  const numMatch = raw.match(/^(\d+)\.\s*/);
  const num = numMatch ? parseInt(numMatch[1], 10) : null;
  let name = numMatch ? raw.slice(numMatch[0].length) : raw;

  let allergens = [];
  const a = name.match(/\(([\d,\s.]+)\)\s*$/); // trailing "(1, 3, 7)"
  if (a) {
    allergens = a[1].split(/[,\s.]+/).filter(Boolean)
      .map((x) => parseInt(x, 10)).filter((n) => !isNaN(n));
    name = name.slice(0, a.index).trim();
  }
  return { num, name, allergens, isSoup: num === null };
}

/** Parse a restaurant detail page; returns today's menu (or hasMenu:false). */
function parseRestaurantPage(html, opts = {}) {
  const now = opts.now || new Date();
  const today = ymd(now);
  const $ = cheerio.load(html);

  const name = ($("h1").first().text() || "").replace(/\s+/g, " ").trim();
  const address = [".street-address", ".locality"]
    .map((s) => ($(s).first().text() || "").trim())
    .filter(Boolean)
    .join(", ");

  let dayEl = null;
  $("div.menicka").each((_, el) => {
    if (dayEl) return;
    const dt = $(el).find("div.nadpis").first().text();
    const dm = dt && dt.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (dm && +dm[1] === today.d && +dm[2] === today.m && +dm[3] === today.y) {
      dayEl = el;
    }
  });

  if (!dayEl) {
    return { name, address, date: null, soup: null, dishes: [], hasMenu: false };
  }

  const items = [];
  $(dayEl).find("ul li").each((_, li) => {
    const nameText = ($(li).find("div.polozka").first().text()
      || $(li).find(".polozka").first().text() || "").trim();
    if (!nameText) return;
    const it = parseItem(nameText);
    it.price = parsePrice($(li).find("div.cena").first().text()
      || $(li).find(".cena").first().text());
    items.push(it);
  });

  const soup = items.find((i) => i.isSoup) || null;
  const dishes = items.filter((i) => !i.isSoup);
  return {
    name,
    address,
    date: `${today.d}.${today.m}.${today.y}`,
    soup,
    dishes,
    hasMenu: !!soup || dishes.length > 0,
  };
}

/** Restaurant candidates (name + detail URL) from a city page's nav list. */
function parseCityCandidates(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $("ul#cityroll a").each((_, a) => {
    const href = $(a).attr("href");
    const nm = ($(a).text() || "").replace(/\s+/g, " ").trim();
    if (href && /\/\d+-/.test(href) && !seen.has(href)) {
      seen.add(href);
      out.push({ name: nm, url: absUrl(href) });
    }
  });
  return out;
}

function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

module.exports = {
  BASE, ymd, absUrl, restaurantUrl, parsePrice, parseItem,
  parseRestaurantPage, parseCityCandidates, haversineKm,
};
