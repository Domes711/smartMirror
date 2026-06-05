/* global Module, Log */

/**
 * MMM-Lunch-Menu — today's lunch menus from menicka.cz.
 * If `restaurants` is set, those are shown; otherwise the nearest `count`
 * to `location` are picked (addresses geocoded via Nominatim).
 */
Module.register("MMM-Lunch-Menu", {
  defaults: {
    restaurants: [],                 // menicka ids or URLs; if set, these win
    location: null,                  // { lat, lon } — used when restaurants is empty
    city: "brno",                    // menicka city slug for the nearby candidate list
    count: 4,                        // how many restaurants to fetch & show
    nearbyPool: 20,                  // candidate pool scanned in nearby mode

    showSoup: true,
    showAllergens: true,
    showPrices: true,
    maxDishes: 0,                    // 0 = all

    updateInterval: 60 * 60 * 1000,  // re-scrape hourly
    userAgent: "MMM-Lunch-Menu (smart mirror, personal use)",
  },

  getStyles() {
    return ["MMM-Lunch-Menu.css"];
  },

  // i18n: English (default) + Czech; displayed language follows the global
  // MagicMirror `config.language`.
  getTranslations() {
    return { en: "translations/en.json", cs: "translations/cs.json" };
  },

  start() {
    this.data_ = null;
    this.loaded = false;
    this.sendSocketNotification("LUNCH_INIT", this.config);
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "LUNCH_MENU") return;
    this.data_ = payload;
    this.loaded = true;
    this.updateDom(300);
  },

  getDom() {
    const w = document.createElement("div");
    w.className = "lunch";

    if (!this.loaded) {
      w.className += " dimmed light small";
      w.innerHTML = this.translate("LOADING");
      return w;
    }
    const list = (this.data_ && this.data_.restaurants) || [];
    if (list.length === 0) {
      w.className += " dimmed light small";
      w.innerHTML = this.translate("NO_RESTAURANTS");
      return w;
    }

    for (const r of list) {
      w.appendChild(this._card(r));
    }
    return w;
  },

  _card(r) {
    const card = document.createElement("div");
    card.className = "lunch-card";

    const head = document.createElement("div");
    head.className = "lunch-name";
    head.textContent = r.name || "Restaurant";
    card.appendChild(head);

    if (r.error) {
      const e = document.createElement("div");
      e.className = "lunch-note dimmed small";
      e.textContent = this.translate(r.error); // r.error is a translation key
      card.appendChild(e);
      return card;
    }
    if (!r.hasMenu) {
      const e = document.createElement("div");
      e.className = "lunch-note dimmed small";
      e.textContent = this.translate("NO_MENU");
      card.appendChild(e);
      return card;
    }

    if (this.config.showSoup && r.soup) {
      card.appendChild(this._row(r.soup, true));
    }
    let dishes = r.dishes || [];
    if (this.config.maxDishes > 0) dishes = dishes.slice(0, this.config.maxDishes);
    for (const d of dishes) card.appendChild(this._row(d, false));

    return card;
  },

  _row(item, isSoup) {
    const row = document.createElement("div");
    row.className = "lunch-item" + (isSoup ? " soup" : "");

    const left = document.createElement("span");
    left.className = "lunch-dish";
    const label = isSoup ? this.translate("SOUP") + ": " : (item.num ? item.num + ". " : "");
    left.textContent = label + (item.name || "");

    if (this.config.showAllergens && item.allergens && item.allergens.length) {
      const a = document.createElement("sup");
      a.className = "lunch-allergens";
      a.textContent = " (" + item.allergens.join(",") + ")";
      left.appendChild(a);
    }
    row.appendChild(left);

    if (this.config.showPrices && item.price != null) {
      const price = document.createElement("span");
      price.className = "lunch-price";
      price.textContent = item.price + " Kč";
      row.appendChild(price);
    }
    return row;
  },
});
