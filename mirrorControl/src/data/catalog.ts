import type { Module, RegionDef } from "@/types";

/** MagicMirror regions in the canonical 3-column grid order. */
export const REGIONS: RegionDef[] = [
  { id: "top_bar", label: "Top bar", cs: "Horní lišta", full: true },
  { id: "top_left", label: "Top left", cs: "Vlevo nahoře", j: "flex-start" },
  { id: "top_center", label: "Top center", cs: "Nahoře uprostřed", j: "center" },
  { id: "top_right", label: "Top right", cs: "Vpravo nahoře", j: "flex-end" },
  { id: "upper_third", label: "Upper third", cs: "Horní třetina", full: true },
  { id: "middle", label: "Middle", cs: "Uprostřed", full: true, j: "center" },
  { id: "lower_third", label: "Lower third", cs: "Dolní třetina", full: true },
  { id: "bottom_left", label: "Bottom left", cs: "Vlevo dole", j: "flex-start" },
  { id: "bottom_center", label: "Bottom center", cs: "Dole uprostřed", j: "center" },
  { id: "bottom_right", label: "Bottom right", cs: "Vpravo dole", j: "flex-end" },
  { id: "bottom_bar", label: "Bottom bar", cs: "Dolní lišta", full: true },
];

/** Reported community-store size (real registry has ~1400). */
export const BROWSE_COUNT = 1412;

/** The seed widget catalog. Localized by `en`. Ported 1:1 from the prototype. */
export function STORE(en: boolean): Module[] {
  return [
    { n: "MMM-Brno-Transit", c: en ? "Brno public transit" : "Brněnská MHD", d: en ? "Next tram, bus and trolley departures from a Brno stop, with realtime delays." : "Příští odjezdy tramvají, autobusů a trolejbusů z brněnské zastávky, včetně zpoždění v reálném čase.", t: ["transit", "realtime", "brno"], mini: ["▭ 9 · 3 min", "▢ 67 · 7 min", "", "BRNO-TRANSIT"] },
    { n: "MMM-HA-Reminders", c: en ? "iPhone reminders" : "iPhone připomínky", d: en ? "Your iPhone reminders on the mirror via Home Assistant." : "Vaše iPhone připomínky na zrcadle přes Home Assistant.", t: ["reminders", "productivity", "iphone"], mini: ["REMINDERS", "○ " + (en ? "Call mom" : "Zavolat mámě"), "○ " + (en ? "Invoice" : "Faktura"), "○ " + (en ? "Parcel" : "Balík")] },
    { n: "MMM-Reminders", c: en ? "Reminders" : "Připomínky", d: en ? "Your important reminders on the mirror — created with the AI assistant." : "Tvé důležité připomínky na zrcadle — vytvořeno přes AI asistenta.", t: ["reminders", "productivity"], own: true, mini: [en ? "REMINDERS" : "PŘIPOMÍNKY", "○ " + (en ? "Pay the rent" : "Zaplatit nájem"), "○ " + (en ? "Q2 report" : "Report Q2")] },
    { n: "MMM-Mail", c: en ? "Email" : "E-mail", d: en ? "Latest unread emails on the mirror." : "Nejnovější nepřečtené e-maily na zrcadle.", t: ["email", "mail", "productivity"], mini: ["— Šárka N.", en ? "meeting 14:00" : "schůzka 14:00", "— David K.", "FA-0411"] },
    { n: "MMM-Package-Tracker", c: en ? "Package tracking" : "Sledování zásilek", d: en ? "Tracks incoming parcels and their status." : "Sleduje příchozí zásilky a jejich stav.", t: ["packages", "delivery", "tracking"], mini: [en ? "PACKAGES" : "BALÍKY", "▦ Amazon", "▦ Kosmas", "⌖ Zásilkovna"] },
    { n: "clock", c: en ? "Clock" : "Hodiny", d: en ? "Large time and date in the corner." : "Velký čas a datum v rohu.", t: ["clock", "time"], mini: ["14:22", en ? "Thu 12 Jun" : "čt 12. čer"] },
    { n: "MMM-Flights", c: en ? "Flights" : "Lety", d: en ? "Departures from your home airport." : "Odlety z vašeho domovského letiště.", t: ["flights", "travel"], mini: ["✈ PRG", "3 " + (en ? "departures" : "odlety")] },
    { n: "MMM-Weather", c: en ? "Weather" : "Počasí", d: en ? "Local forecast with temperature and conditions." : "Místní předpověď s teplotou a aktuálními podmínkami.", t: ["weather", "forecast", "brno"], mini: [en ? "☂ 18° rain" : "☂ 18° déšť", en ? "Brno · feels 16°" : "Brno · pocit 16°", "", "WEATHER"] },
    { n: "MMM-Calendar", c: en ? "Calendar" : "Kalendář", d: en ? "Upcoming events from your calendar." : "Nadcházející události z vašeho kalendáře.", t: ["calendar", "events", "productivity"], mini: [en ? "CALENDAR" : "KALENDÁŘ", "▤ Standup 10:00", "▤ " + (en ? "Lunch 12:30" : "Oběd 12:30"), "▤ " + (en ? "Gym 18:00" : "Posilovna 18:00")] },
    { n: "MMM-NowPlaying", c: en ? "Now playing" : "Právě hraje", d: en ? "Currently playing track from Spotify with album art and controls." : "Aktuálně přehrávaná skladba ze Spotify s obalem alba a ovládáním.", t: ["music", "spotify", "media"], mini: [en ? "NOW PLAYING" : "PRÁVĚ HRAJE", "♪ Bonobo", "— Kerala", "▶ ───●──"] },
    { n: "MMM-AirQuality", c: en ? "Air quality" : "Kvalita ovzduší", d: en ? "Local air quality index with pollutant breakdown." : "Místní index kvality ovzduší s rozpisem znečišťujících látek.", t: ["air", "health", "environment"], mini: [en ? "AIR · GOOD" : "OVZDUŠÍ · DOBRÉ", "AQI 42", "PM2.5 11", "PM10 19"] },
    { n: "MMM-Fuel", c: en ? "Fuel prices" : "Ceny paliv", d: en ? "Cheapest fuel stations near you with live prices." : "Nejlevnější čerpací stanice v okolí s aktuálními cenami.", t: ["fuel", "car", "prices"], mini: [en ? "FUEL" : "PALIVO", "⛽ 35.90 Natural", "⛽ 37.40 Diesel", "MOL · 1.2 km"] },
    { n: "MMM-Crypto", c: en ? "Crypto ticker" : "Krypto kurzy", d: en ? "Live cryptocurrency prices and 24h change." : "Živé kurzy kryptoměn a změna za 24 h.", t: ["crypto", "finance", "ticker"], mini: [en ? "CRYPTO" : "KRYPTO", "BTC 64.2k ▲", "ETH 3.1k ▲", "SOL 142 ▼"] },
    { n: "MMM-Wikifeed", c: en ? "On this day" : "Tento den", d: en ? "Historical events that happened on today’s date." : "Historické události, které se staly v dnešní den.", t: ["history", "facts", "wikipedia"], mini: [en ? "ON THIS DAY" : "TENTO DEN", "1969 · Apollo", "1989 · " + (en ? "Wall" : "Zeď"), "2004 · " + (en ? "Mars" : "Mars")] },
    { n: "MMM-Quotes", c: en ? "Daily quote" : "Citát dne", d: en ? "A rotating inspirational quote each day." : "Každý den se střídající inspirativní citát.", t: ["quotes", "text", "motivation"], mini: [en ? "QUOTE" : "CITÁT", "“Stay hungry,", "stay foolish.”", "— Jobs"] },
    { n: "MMM-Sports", c: en ? "Sports scores" : "Sportovní výsledky", d: en ? "Live scores and fixtures for your favourite teams." : "Živé výsledky a rozpis zápasů tvých oblíbených týmů.", t: ["sports", "scores", "football"], mini: [en ? "SPORTS" : "SPORT", "Kometa 3:2", "Sparta 1:0", "▶ 19:00"] },
  ];
}

export interface CatDef {
  tag: string;
  cs: string;
  en: string;
}

export const CATEGORIES: CatDef[] = [
  { tag: "productivity", cs: "Produktivita", en: "Productivity" },
  { tag: "weather", cs: "Počasí", en: "Weather" },
  { tag: "transit", cs: "Doprava", en: "Transit" },
  { tag: "finance", cs: "Finance", en: "Finance" },
  { tag: "travel", cs: "Cestování", en: "Travel" },
  { tag: "media", cs: "Média", en: "Media" },
  { tag: "health", cs: "Zdraví", en: "Health" },
  { tag: "sports", cs: "Sport", en: "Sports" },
  { tag: "calendar", cs: "Kalendář", en: "Calendar" },
  { tag: "email", cs: "E-mail", en: "Email" },
];

/** Localized display name for a widget id (falls back to the id). */
export function fmod(id: string, en: boolean): string {
  if (!id) return id;
  const m = STORE(en).find((x) => x.n === id);
  return m ? m.c : id;
}
