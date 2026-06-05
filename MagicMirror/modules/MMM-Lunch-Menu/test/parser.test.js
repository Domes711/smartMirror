"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const P = require("../lunch-parser");

// Minimal fixture mirroring the menicka.cz detail-page structure.
const FIXTURE = `
<html><body>
  <h1>Restaurace Sharingham</h1>
  <span class="street-address">Vídeňská 223/1</span>
  <span class="locality">Brno</span>

  <div class="menicka">
    <div class="nadpis">Pátek 5.6.2026</div>
    <ul>
      <li><div class="polozka">Frankfurtská s párky (1)</div><div class="cena">35 Kč</div></li>
      <li><div class="polozka">1. Krémové risotto s brokolicí (7)</div><div class="cena">179 Kč</div></li>
      <li><div class="polozka">2. Smažený řízek s kaší (1, 3, 7)</div><div class="cena">189 Kč</div></li>
    </ul>
  </div>

  <div class="menicka">
    <div class="nadpis">Sobota 6.6.2026</div>
    <ul><li><div class="polozka">Pro tento den nebylo zadáno menu</div></li></ul>
  </div>
</body></html>`;

const NOW = new Date(2026, 5, 5); // 5 June 2026 (month is 0-based)

test("parseItem: soup vs numbered dish + allergens", () => {
  const soup = P.parseItem("Frankfurtská s párky (1)");
  assert.equal(soup.isSoup, true);
  assert.equal(soup.num, null);
  assert.deepEqual(soup.allergens, [1]);
  assert.equal(soup.name, "Frankfurtská s párky");

  const d = P.parseItem("2. Smažený řízek s kaší (1, 3, 7)");
  assert.equal(d.isSoup, false);
  assert.equal(d.num, 2);
  assert.deepEqual(d.allergens, [1, 3, 7]);
  assert.equal(d.name, "Smažený řízek s kaší");
});

test("parsePrice", () => {
  assert.equal(P.parsePrice("179 Kč"), 179);
  assert.equal(P.parsePrice(" 35 Kč "), 35);
  assert.equal(P.parsePrice(""), null);
});

test("parseRestaurantPage: today's menu", () => {
  const m = P.parseRestaurantPage(FIXTURE, { now: NOW });
  assert.equal(m.name, "Restaurace Sharingham");
  assert.match(m.address, /Vídeňská 223\/1, Brno/);
  assert.equal(m.hasMenu, true);
  assert.equal(m.date, "5.6.2026");
  assert.ok(m.soup && m.soup.price === 35);
  assert.equal(m.dishes.length, 2);
  assert.equal(m.dishes[0].num, 1);
  assert.equal(m.dishes[0].price, 179);
  assert.deepEqual(m.dishes[1].allergens, [1, 3, 7]);
});

test("parseRestaurantPage: no menu for a non-matching day", () => {
  const m = P.parseRestaurantPage(FIXTURE, { now: new Date(2026, 5, 8) });
  assert.equal(m.hasMenu, false);
  assert.equal(m.dishes.length, 0);
});
