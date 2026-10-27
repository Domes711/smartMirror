# Mirror Control — Kompletní handoff pro React aplikaci

Tento dokument popisuje **kompletní design, datový model, navigaci a chování** mobilní aplikace „Mirror Control" tak, aby podle něj jiný AI agent dokázal postavit produkční React aplikaci. Předloha je hotový prototyp (jeden telefonní rám, dvojjazyčné UI CS/EN). Vše níže je odvozeno z reálné implementace prototypu, ne z domněnek.

---

## 0. Co aplikace dělá

Mirror Control je **doprovodná mobilní aplikace pro chytré zrcadlo** (MagicMirror²). Uživatel z telefonu vzdáleně konfiguruje, co se na zrcadle zobrazuje. Aplikace řídí čtyři propojené entity:

- **Profily** — identity rozpoznávané podle obličeje. `default` profil běží, když zrcadlo nikoho nepozná.
- **Scény (Scény / Layouts)** — znovupoužitelná rozložení widgetů do regionů zrcadla. Profily a rozvrhy scénu jen *odkazují* (odděleno „co" od „kdo" a „kdy").
- **Widgety (Moduly)** — obchod s ~1400 MagicMirror moduly + **AI tvůrce widgetů** (popíšu → chatuju → živý náhled → instalace).
- **Časová okna** — rozvrh; každé okno = časový úsek + scéna.

**Domovská obrazovka JE zrcadlo** („Zrcadlo"): živý náhled aktuálního stavu zrcadla + status + jedno globální „Aplikovat" pro rozpracované změny.

Aplikace je **dvojjazyčná** (čeština výchozí, angličtina). Obsahuje skrytý **dev mód** (5× klik na wordmark → heslo `1234`) s nástroji radar / kamera / komunikace (MQTT).

---

## 1. Doporučený technický stack

| Oblast | Doporučení |
|---|---|
| Framework | React 18 + Vite (nebo Next.js, ale aplikace je čistě klientská SPA) |
| Jazyk | TypeScript (datové modely níže jsou navržené pro typy) |
| Stav | Jeden centrální store — `zustand` nebo `useReducer` + Context. Prototyp je jeden velký stavový objekt; doporučuji rozdělit do slices (scenes, profiles, modules, ui, dev). |
| Styling | CSS Modules nebo Tailwind s custom tokeny (níže). Prototyp používá inline styly — pro React doporučuji tokenizovat. |
| Routing | Stavový „screen" router stačí (žádné URL nutné), ale lze namapovat na React Router pro deep-linky. |
| Fonty | Google Fonts: **Space Grotesk** (300–700), **Space Mono** (400/700) |
| i18n | Jednoduchý slovník `LABELS[lang]` (níže), `react-i18next` je overkill ale fungoval by |
| Animace | CSS keyframes (viz §12) — žádná těžká knihovna není potřeba |

**Důležité:** prototyp řeší veškerou „live" data simulací (setTimeout, fake progress). V produkční React app tyto simulace nahraď reálnými API/WebSocket/MQTT voláními ke zrcadlu, ale **zachovej stejné UI stavy** (loading skeleton, task progress bar, agent „pracuje" bar).

---

## 2. Design tokeny (barvy)

Estetika: **„Aeonik Fono"** — papírový minimalismus, monospace/geometrický typ, vlasové linky, tmavé invertované panely pro obsah zrcadla, jedna funkční červená a jedna měkká pastelově-žlutá.

```css
:root {
  --paper:       #E9E8DD; /* pozadí appky (teplá krémově-zelená) */
  --paper-2:     #EFEEE4; /* vyvýšený povrch — karty */
  --paper-3:     #E2E1D5; /* zapuštěný povrch — inputy, tracky, thumbnaily */
  --ink:         #1A1A17; /* primární text, linky, invertované panely, plné tlačítko */
  --ink-2:       #3A3A34; /* sekundární text / body */
  --mute:        #8C8C81; /* neaktivní labely, popisky, eyebrows */
  --line:        #CFCEC2; /* vlasové borders / dividery */
  --signal:      #E5482F; /* vermilion červená — POUZE aktivní/vybraný marker */
  --butter:      #FFC34D; /* pastelově žlutá — jemný highlight / „held" stav */
  --butter-soft: #FFE6B3; /* slabý butter tint pro výplně */
  --butter-line: #F0AD33; /* butter border */
  --butter-ink:  #6B6212; /* čitelný text na butter */
  --green:       #3B8A4F; /* status „online" tečka */
}
```

Doplňky telefonního rámu: vnější rám border `#BCBBB0`, vnitřní prstenec `#F1F0E7`, backdrop stránky radiální `#E2E1D6 → #CFCEC2`.

### Sémantika akcentů (přísně dodržet)

- **Červená `--signal`** = *aktivní / vybrané / live pointer*. Použití: aktivní marker spodní navigace (červený trojúhelník), aktivní pill/tab marker, chip **vybraný na plátně editoru**, „rozpracované změny → Aplikovat" banner, live-data tečky v panelech zrcadla, REC tečka. **Nikdy výplň obsahu, nikdy dekorativně.**
- **Pastelově žlutá `--butter`** = *držené / nachystané / jemný highlight*. Použití: widget z palety **zvednutý** a nachystaný k umístění, scéna právě **„na zrcadle"** (slabý tint karty + badge), pill aktivní scény na Home, dočasně aktivní profil banner.
- **Zelená** = pouze online status.

---

## 3. Typografie

Pravidlo: **je-li to číslo, label nebo status → Space Mono. Je-li to věta nebo nadpis → Space Grotesk.**

| Styl | Font | Velikost / váha | Tracking / case |
|---|---|---|---|
| Titulek stránky (h1) | Space Grotesk | 27px / 600 | −0.02em |
| Nadpis sekce (h2) | Space Grotesk | 20–24px / 600 | −0.01em |
| Body / popis | Space Grotesk | 13–14px / 400 | line-height 1.5–1.6, `--ink-2` |
| Wordmark | Space Mono | 13px / 700 | 0.20em, UPPERCASE |
| Eyebrow / label sekce | Space Mono | 10px / 400 | 0.18em, UPPERCASE, `--mute` |
| Region label (na zrcadle) | Space Mono | 7px / 400 | 0.14em, UPPERCASE |
| Data / počty / čas | Space Mono | 11–13px | tabulární pocit |
| Velké hodiny zrcadla | Space Mono | 22px / 700 | — |
| Nav label | Space Mono | 9.5px | 0.08em, UPPERCASE |

---

## 4. Tvar, spacing, pohyb

- **Radiusy:** karty 16px; pills/tlačítka/chipy 999px; inputy 12px; malé region boxy 8–11px; telefonní rám 46px.
- **Borders:** 1px vlasová `--line` výchozí; 1px `--ink` pro primární obrysy (back tlačítko, segmented active, gear). Obrysy regionů v editoru jsou **1px dashed** na tmavém zrcadle.
- **Padding obrazovky:** 18px / 22px. Padding karty 16px.
- **Stíny:** žádné na UI; pouze telefonní rám (`0 30px 80px -30px rgba(0,0,0,.45)` + vnitřní prstenec).
- **Pohyb:** vstup obrazovky `opacity + translateY(6px)` přes .28s; hover tlačítka `translateY(-1px)`; toggly/gear .18–.2s; toast vyjede zdola. Drž to tiché.

---

## 5. App shell / layout

```
┌────────────────────────────────────┐
│ status bar  (čas · signál · 19%)    │  Space Mono, padding 16/30
├────────────────────────────────────┤
│ CHROME: MIRROR CONTROL [DEV] ···· ⚙ │  vlasový spodní border
├────────────────────────────────────┤
│ (kondiční pruhy: task / temp / agent)│  viz §10
├────────────────────────────────────┤
│                                    │
│   STAGE (scrollující obrazovka)    │  jedna .screen viditelná
│                                    │
├────────────────────────────────────┤
│  ▼červená                          │
│ Zrcadlo  Scény  Widgety  Profily   │  spodní nav, vlasový top border
└────────────────────────────────────┘
```

- **Telefonní rám:** max-width 392px, výška `min(844px, 92vh)`, vystředěný na backdrop.
- **Chrome:** wordmark „MIRROR CONTROL" vlevo (klikací — 5× otevře dev login), gear vpravo. V dev módu se vedle wordmarku zobrazí červený pill `DEV` (klik = exit dev).
- **Spodní nav:** 4 destinace (Zrcadlo / Scény / Widgety / Profily), mono uppercase, line ikony. Aktivní = `--ink` + **červený trojúhelník** nad labelem (žádná výplň). Nastavení přes gear, ne v baru. **V dev módu** se nav přepne na Radar / Kamera / Komunikace.
- Nastavení obrazovka skryje spodní nav.

---

## 6. Kompletní stavový model

Toto je přesný tvar stavu prototypu. V Reactu rozděl do slices, ale tohle je úplný seznam toho, co aplikace drží:

```ts
interface AppState {
  // --- jazyk & navigace ---
  lang: 'cs' | 'en';                 // výchozí 'cs'
  screen: ScreenId;                  // aktuální obrazovka, viz §7
  tab: TabGroup;                     // zvýrazněný tab ve spodní navigaci
  tabScreens: Record<TabGroup, ScreenId>; // poslední obrazovka v každém tabu (kontinuita)
  settingsReturn?: ScreenId; settingsReturnTab?: TabGroup; // kam zpět z nastavení

  // --- dev mód ---
  devMode: boolean;                  // false
  pwModal: boolean; pwInput: string; pwError: boolean;
  radarActive: boolean;              // true
  zoneCx: number; zoneW: number; zoneFar: number; // detekční kužel radaru (-0.1, 0.7, 1.3)
  connState: 'idle' | 'scanning' | 'found'; scanIp: string;
  commsPanel: boolean; commsName: string; sentMsgs: MqttMsg[];

  // --- globální async task (progress bar) ---
  taskActive: boolean; taskPct: number; taskLabel: string;
  taskKind: 'retrain' | 'install' | null; taskTarget: string | null;

  // --- AI agent (workshop) ---
  agentBusy: boolean; agentReady: boolean; agentStatus: string; agentMod: string;
  createTab: 'new' | 'drafts';
  wsBackModal: boolean; wsEditing: boolean;
  wsImportantOnly: boolean; wsMaxCount: number; // ovladač náhledu (5)
  ctrlFormOpen: boolean; ctrlWhat: string; ctrlType: 'toggle'|'select'|'slider'; ctrlDefault: string;
  workshopMod: string; workshopTab: 'chat' | 'preview';
  chat: ChatMsg[]; chatDraft: string;
  createName: string; createDesc: string;

  // --- widgety / obchod ---
  installed: string[];               // ID nainstalovaných widgetů
  modFilter: 'mine' | 'installed' | 'search';
  search: string; searchOpen: boolean; searchCat: string | null;
  detailMod: Module | null;
  deletedMods: string[];             // smazané vlastní widgety
  drafts: Draft[];

  // --- scény & editor ---
  activeScene: string;               // ID scény „na zrcadle" ('day')
  scenes: Record<string, Scene>;
  live: Regions | null;              // snapshot aplikovaný na zrcadlo
  dirty: number;                     // počet nepublikovaných změn
  editing: string | null;            // ID editované scény
  editReturn: ScreenId;              // kam zpět z editoru
  editSnap: string;                  // JSON snapshot pro detekci změn
  picked: string | null;             // widget zvednutý z palety (žlutý)
  selChip: { region: string; mod: string } | null; // chip vybraný na plátně
  palRemove: string | null;
  zoneOpen: string | null;           // otevřený region (bottom sheet)
  newSceneModal: boolean; nsName: string; nsStart: number; nsEnd: number; nsNoSlot?: boolean;
  timeEditOpen: boolean; teStart: number; teEnd: number;
  delModal: boolean; uninstallModal: string|null; deleteModModal: string|null; editBackModal: boolean;

  // --- profily ---
  profiles: Profile[];               // [{id:'eliska',name:'Eliška',photos:12,scenes:3}]
  profileName: string;               // aktuálně otevřený profil ('default')
  profileTab: 'scenes' | 'settings';
  tempActiveProfile: string | null;  // dočasně aktivovaný profil (žlutý banner)
  profileDelOpen: boolean;
  facePhotos: FacePhoto[];           // 12 fotek
  photoSheet: string|null; photoDelModal: string|null;
  photoSource: 'mirror' | 'phone'; sessionPhotos: FacePhoto[];

  // --- nový profil wizard ---
  npStep: 1|2|3; npName: string; npPhotos: number; npScenes: string[]; npSource: string|null; npSheet: boolean;

  // --- časová okna ---
  windows: { time: string; scene: string }[]; winSeq: number;

  // --- ostatní ---
  time: string;                      // 'HH:MM', tick každých 10s
  settings: { conn: boolean; face: boolean; night: boolean };
  toast: string;                     // text toastu (auto-zmizí za 1.7s)
  homeLoading: boolean;              // mirror skeleton loader
}
```

---

## 7. Obrazovky (screens)

`screen` je ID jedné z 17 obrazovek. Každá patří do skupiny (`groupOf`) která určuje zvýrazněný tab:

```
groupOf = {
  home, windows           → tab 'home'    (Zrcadlo)
  scenes, editor          → tab 'scenes'  (Scény)
  modules, moddetail, create, workshop → tab 'modules' (Widgety)
  profiles, profile, addphotos, newprofile → tab 'profiles' (Profily)
  radar, camera, comms    → dev tabs
  settings                → (skryje nav)
}
```

### Mapa obrazovek a jejich obsahu

**`home` — Zrcadlo (domov)**
- h1 „Zrcadlo". Živý náhled zrcadla (komponenta Mirror v režimu `preview`, aspect 9/14) s „LIVE" badge v rohu. Při načtení 1.9s **skeleton loader** (tmavý panel + červený scan sweep + „Synchronizuji zrcadlo…").
- Pokud `dirty > 0`: červený **draft banner** „N nepublikovaných změn → Aplikovat".
- Tlačítka: „Upravit scénu" (→ editor aktivní scény přes windows-flow) a „Probudit" (toast).
- Status řádky (mono, label vlevo / hodnota vpravo, vlasový divider): Aktivní scéna (žlutý pill), Profil (`default`), Připojení (`● online · 192.168.1.42`, zelená), Widgety v provozu (počet).

**`windows` — Časová okna**
- Back tlačítko „← Zrcadlo" + h2. Eyebrow „default · kdy se co zobrazí".
- „+ Přidat časové okno" → vytvoří okno a **rovnou otevře editor** jeho scény. Hint text.
- Seznam oken: `čas → [scéna pill] → N wid.`, klik otevře editor.
- Spodní „Aplikovat na zrcadlo" → aplikuje + zpět Home.

**`scenes` — Scény (knihovna)**
- h1 „Scény" + „+ Scéna" tlačítko. Hint.
- **Časová mřížka (kalendář)**: vertikální osa 00:00–24:00, 36px/hodina. Scény jsou bloky umístěné podle `startH`/`endH`. „Celý den" scény nad mřížkou. Červená „now" linka na aktuálním čase. Každý blok = mini-mirror thumbnail + název + čas + seznam widgetů. Scéna na zrcadle = butter tint + „● na zrcadle". Klik → editor.
- Modál „Nová scéna": název, čas Od/Do (hodina+minuta selecty po 5 min). Validace: scény se nesmí překrývat (`nsConflict`), konec po začátku.

**`editor` — Editor scény (plátno)** — viz §8 detailně
- Back (s detekcí neuložených změn → modál), editovatelný název scény, čas (klik → time-edit modál).
- **Mirror v režimu `edit`**: všechny regiony viditelné s dashed obrysem + label, počet widgetů v každém. Klik na region → bottom sheet pro správu widgetů v regionu.
- **Paleta** dole: nainstalované widgety. Zvednutý = žlutý. Použité v této scéně = ztlumené s „✓ Použito" badge.
- „Smazat" (danger, → confirm modál) + „Uložit scénu".

**`modules` — Widgety (obchod)**
- h1 „Widgety" + počet. „+ Vytvořit widget (AI)" prominentní.
- Filtr pills: Moje / Instalované / Prohledat (s počty). „Prohledat" → fullscreen search overlay s klávesnicí (QWERTZ) a kategoriemi.
- Karty widgetů: tmavý 70px thumbnail (mono mini-preview) + název (Grotesk 16/600) + kategorie + 1-řádkový popis + tagy. Klik → detail.

**`moddetail` — Detail widgetu**
- Back. Invertovaný živý náhled, název, kategorie, popis, tagy.
- Stav: nenainstalovaný → „Nainstalovat" (spustí install task s progress). Nainstalovaný → „Odinstalovat" (cizí) / „Upravit" + „Smazat" (vlastní `own:true`). Confirm modály.

**`create` — Vytvořit widget (AI)**
- Sub-taby: „Nový widget" / „Rozpracované widgety".
- Nový: jméno widgetu + textarea „co má dělat" → „Vytvořit a pokračovat →" otevře dílnu.
- Rozpracované: karty draftů → otevřou dílnu.

**`workshop` — Dílna (AI chat + náhled)**
- Back (→ modál „uložit do konceptů / instalovat"). Taby Chat / Náhled.
- **Chat**: zelený puzzle glyph, bubliny (bot = plain text, uživatel = ink fill). Composer + návrhové pills. Odeslání spustí **simulaci AI agenta**: 4 status kroky (Analyzuji… → Navrhuji strukturu… → Generuji kód… → Sestavuji náhled…), pak bot odpoví.
- **Náhled**: živý widget (Připomínky) + „Ovladač" (toggle „jen důležité" + max počet 3/5/8) — ovladač jen pro náhled, na zrcadle se nezobrazí. „Přidat ovladač" → formulář (co ovládat / typ / výchozí).
- „Instalovat" → install task → přidá do `installed`.

**`profiles` — Profily**
- h1 + „+ Profil". Karty: default (žlutý tag „výchozí", „Běží když nikoho nerozpozná"), uživatelské profily (fotky / scény / okna). Klik → detail.

**`profile` — Detail profilu**
- Back. Taby „Scény" / „Nastavení".
- **Scény**: časová mřížka jako u Scén (plán — kdy co), „+ Přidat okno". Pod tím „Rozpoznání obličeje": grid fotek, „Přidat fotky", „Přetrénovat".
- **Nastavení**: „Dočasně aktivovat" (zobrazí profil na zrcadle, ignoruje radar — žlutý banner nahoře), „Odstranit profil" (default nelze). Confirm modály.

**`addphotos` — Přidat fotky**
- Back. Volba zdroje: „Kamera na zrcadle" / „Fotky z mobilu". „Pořídit fotku" / „Vybrat fotky" → přidá do session (živý náhled kamery zrcadla). „Použít fotky" → retrain task.

**`newprofile` — Nový profil (wizard, 3 kroky)**
- Krok 1: pojmenuj profil. Krok 2: fotky pro rozpoznání (pořiď několik). Krok 3: přidej scény (volitelné, lze přeskočit).
- „Vytvořit profil" → vytvoří profil + spustí trénovací task „Vytvářím profil {name}…".

**`settings` — Nastavení** (skryje nav)
- Back. Jazyk (CS/EN segmented). Připojení (toggle + „Vyhledat zrcadlo" scan flow: idle → scanning s fake IP → found). Rozpoznávání obličeje (toggle). Noční ztlumení (toggle 22:00–06:00).

**DEV obrazovky** (jen v devMode):
- **`radar`** — vizualizace radaru: kužel detekce (zoneCx/zoneW/zoneFar slidery), animovaný beam, detekovaný cíl, počet osob. Toggle radaru aktivní/vypnuto.
- **`camera`** — náhled kamery zrcadla.
- **`comms`** — MQTT log + presety zpráv (motion, person detected, face recognised, profile activated, wake) → odeslání loguje do `sentMsgs`. Volba jména (Eliška/Marek/Host).

---

## 8. Komponenta Mirror (signature)

Téměř černý panel jako reálná geometrie regionů MagicMirror — **3sloupcový grid**:

```
TOP BAR            (full šířka)
TOP LEFT  TOP CENTER  TOP RIGHT
UPPER THIRD        (full)
MIDDLE             (full, centered)
LOWER THIRD        (full)
BOTTOM LEFT  BOTTOM CENTER  BOTTOM RIGHT
BOTTOM BAR         (full)
```

Definice regionů (`id`, EN label, CS label, `full` = celá šířka, `j` = justify):
```
top_bar(full) · top_left(flex-start) · top_center(center) · top_right(flex-end)
· upper_third(full) · middle(full,center) · lower_third(full)
· bottom_left(flex-start) · bottom_center(center) · bottom_right(flex-end) · bottom_bar(full)
```

Tři režimy:
- **`preview`** (aspect 9/14) — read-only „vyrenderované" zrcadlo. Zobrazí jen naplněné regiony; widgety se renderují jako mini (clock = velký čas+datum; transit = linky; mail/flights/packages = lead+sub). Na Home a jako malé thumbnaily scén. Pozadí `--ink`, text `--paper`.
- **`edit`** — každý region viditelný s dashed obrysem + tiny uppercase label. Místo plných widgetů ukáže **počet** widgetů (velké číslo + „widgetů"). Klik na region → bottom sheet. Pozadí `--paper-3`, text `--ink`. Source region při přesunu = červený. Při „held" stavu (zvednutý widget) všechny regiony žlutě dashed s `+`.
- **`thumb`** (aspect 9/13) — mini náhled scény v knihovně. Jen šedé proužky kde jsou widgety.

### Model umístění widgetů
`Scene.regions` = `Record<regionId, string[]>` (pole ID widgetů v pořadí). Operace:
- `addModToZone(rid, mod)` — přidá na konec regionu (pokud tam není).
- `moveModInZone(rid, idx, dir)` — posun v pořadí (šipky nahoru/dolů).
- `removeMod(rid, mod)` — odebere; prázdný region se smaže z objektu.
- Drag-free model: klep widget v paletě (zežloutne) → klep `+` v cílovém regionu → umístí. Klep umístěný chip (zčervená) → klep jiný region → přesune.

---

## 9. Datové modely a seed data

```ts
interface Scene {
  name: string; name_en: string;
  use: string; use_en: string;       // popis „použito v" / rozvrh
  startH: number; endH?: number;     // hodiny pro mřížku
  startLabel: string; endLabel: string;
  scheduled: boolean; allDay?: boolean;
  regions: Record<string, string[]>; // region → pole widget ID
}

interface Module {
  n: string;   // ID, kanonický MagicMirror název (např. 'MMM-Brno-Transit', 'clock')
  c: string;   // zobrazený název (lokalizovaný)
  d: string;   // popis (lokalizovaný)
  t: string[]; // tagy/kategorie
  own?: boolean; // vlastní widget (lze smazat)
  mini: string[]; // řádky mono mini-preview
}

interface Profile { id: string; name: string; photos: number; scenes: number; }
interface FacePhoto { id: string; hue: number; n: number; }
interface Draft { n; c; ce; d; de; t[]; te[]; mini[]; } // c/ce = CS/EN název, d/de = popis
interface ChatMsg { role: 'me'|'bot'; text: string; kind?: 'ctrl'|'status'; }
interface MqttMsg { t: string; dir: string; dirColor: string; topic: string; payload: string; }
```

### Seed scény
```js
day:     { name:'Denní'/'Daytime',   use:'default · 10:00–18:00', startH:10, endH:18, scheduled:true,
           regions:{ top_left:['clock'], top_right:['MMM-Brno-Transit'], bottom_center:['MMM-Flights'],
                     middle:['MMM-Mail','MMM-Calendar','MMM-Weather','MMM-HA-Reminders'] } }
morning: { name:'Ranní'/'Morning',   use:'Eliška · po–pá 06:00–10:00', startH:6, endH:10, scheduled:true,
           regions:{ top_left:['clock'], top_right:['MMM-Brno-Transit'], middle:['MMM-Mail'] } }
evening: { name:'Večerní'/'Evening', use:'nepoužito', startH:18, endH:23, scheduled:false,
           regions:{ top_center:['clock'], lower_third:['MMM-Package-Tracker'] } }
```
`activeScene = 'day'`.

### Katalog widgetů (STORE) — 16 položek
ID · kategorie · tagy:
```
MMM-Brno-Transit  Brněnská MHD        [transit, realtime, brno]
MMM-HA-Reminders  iPhone připomínky   [reminders, productivity, iphone]
MMM-Reminders     Připomínky          [reminders, productivity]  own:true
MMM-Mail          E-mail              [email, mail, productivity]
MMM-Package-Tracker Sledování zásilek [packages, delivery, tracking]
clock             Hodiny              [clock, time]
MMM-Flights       Lety                [flights, travel]
MMM-Weather       Počasí              [weather, forecast, brno]
MMM-Calendar      Kalendář            [calendar, events, productivity]
MMM-NowPlaying    Právě hraje         [music, spotify, media]
MMM-AirQuality    Kvalita ovzduší     [air, health, environment]
MMM-Fuel          Ceny paliv          [fuel, car, prices]
MMM-Crypto        Krypto kurzy        [crypto, finance, ticker]
MMM-Wikifeed      Tento den           [history, facts, wikipedia]
MMM-Quotes        Citát dne           [quotes, text, motivation]
MMM-Sports        Sportovní výsledky  [sports, scores, football]
```
Každý má i `mini` (3–4 řádky mono náhledu) a EN/CS varianty `c`/`d`. Obchod hlásí „1412 widgetů" (`browseCount`), reálně jich je 16 — v produkci napoj na reálný MagicMirror registry.

`installed` seed: `['clock','MMM-Flights','MMM-Brno-Transit','MMM-Mail','MMM-Package-Tracker','MMM-Weather','MMM-Calendar','MMM-Reminders']`.

Kategorie pro search: Produktivita, Počasí, Doprava, Finance, Cestování, Média, Zdraví, Sport, Kalendář, E-mail.

---

## 10. Klíčové interakce a stavové pruhy

**Draft vs. Live.** Home náhled vždy odráží *aplikovaný* (`live`) stav. Editace scény zvyšuje `dirty`. Home ukáže červený banner „N nepublikovaných změn → Aplikovat". Apply nasnapshotuje aktivní scénu do `live` a vynuluje banner. **Jedno globální Apply** místo rozházených tlačítek.

**Decoupled scény.** Scéna se edituje jednou a je odkazovaná z oken/profilů — editace „Ranní" se projeví všude, kde je naplánovaná.

**Kontinuita tabů.** Pushnutý editor drží zvýrazněný původní tab (Home flow → svítí Zrcadlo; Scény flow → svítí Scény). `tabScreens` pamatuje poslední obrazovku v každém tabu.

**Held vs. selected.** Žlutá = v ruce (paleta), červená = na plátně (vybraný chip).

**Globální async pruhy** (pod chrome, kondiční, zachovat v Reactu):
1. **Task bar** (`taskActive`) — animovaný spinner + label + červený progress 0→100%. Pro install / retrain / trénink profilu. Po dokončení 0.7s delay → callback (přidá widget, toast). Na progress jdou fake přírůstky; v produkci napoj na reálný progress.
2. **Temp profile bar** (`tempActiveProfile`) — žlutý banner „Dočasně aktivní · {profil}" s „ukončit".
3. **Agent bar** (`agentBusy || agentReady`) — žlutý, „AI agent pracuje…" (spinner) / „Widget připraven · otevřít" (klik → dílna). Zobrazí se mimo workshop obrazovku.

**AI agent simulace.** `send(text)` v dílně: vyčistí timery, projede 4 status kroky (~á 700ms) měnící `agentStatus`, pak vloží bot odpověď do `chat`. Pokud uživatel není v dílně, ukáže agent bar. V produkci = reálné LLM volání s streamovaným stavem, ale **zachovej 4-krokový status UI**.

**Dev mód.** 5× klik na wordmark (s toastem „Ještě N kliků") → modál hesla → `1234` → devMode on, nav se přepne na Radar/Kamera/Komunikace, otevře radar. Červený `DEV` pill = exit.

**Toast.** Ink pill, mono, červená tečka, vyjede zdola-střed, ~1.7s. Lokalizované zprávy (`tApplied`, `tInstalled`, `tProfileAdded`…).

**Časovač.** `time` se aktualizuje každých 10s na reálný `HH:MM`. Hodiny widget a status to používají.

---

## 11. Lokalizace (i18n)

- **Veškeré UI je dvojjazyčné CS/EN.** Prototyp má jeden plochý slovník `LABELS = { cs: {...}, en: {...} }` s ~200 klíči. Přepínač jazyka je v Nastavení.
- MagicMirror názvy widgetů zůstávají kanonické (`MMM-Brno-Transit`, `clock`) v obou jazycích.
- Datové objekty mají duální pole (`name`/`name_en`, `use`/`use_en`, draft `c`/`ce`).
- Mono labely krátké a uppercase; věty (popisy, hinty) sentence-case v Space Grotesk.
- Region názvy na zrcadle: EN konvence (TOP BAR, MIDDLE…) ale prototyp je v edit režimu lokalizuje (CS „Horní lišta" atd.) — v produkci zvaž ponechat EN dle MagicMirror konvence.

---

## 12. CSS keyframes (z prototypu, převzít)

```
scin:      opacity 0→1, translateY(6px→0)        .28s   /* vstup obrazovky */
toastin:   opacity 0→1, translateY(20px→0)              /* toast */
mc-scan:   top 0→99%, opacity .45→1→.45           1.6s  /* červený scan loaderu */
mc-shimmer:opacity .22↔.5                          1.7s /* skeleton proužky */
mc-blink:  opacity 1↔.15                           1.2s /* tečky */
mc-fade:   opacity 0→1                             .45s
mc-sheet:  translateY(100%→0)                            /* bottom sheet */
mc-sweep:  rotate(0→360)                           .9s  /* spinner */
mc-ping / mc-wiper / mc-rec / mc-hscan                  /* radar / REC efekty */
```

---

## 13. Doporučená React struktura

```
src/
  app/
    Store.ts            // centrální stav (zustand slices: ui, scenes, modules, profiles, dev)
    i18n.ts             // LABELS slovník + useT() hook
    tokens.css          // CSS proměnné z §2
  components/
    PhoneFrame.tsx      // rám + status bar + chrome + nav + globální pruhy + toast
    BottomNav.tsx
    Mirror.tsx          // 3 režimy (preview/edit/thumb) — viz §8
    MirrorLoader.tsx    // skeleton + scan
    TaskBar.tsx  AgentBar.tsx  TempBar.tsx  Toast.tsx
    Modal.tsx  BottomSheet.tsx  Toggle.tsx  Segmented.tsx  Pill.tsx  Card.tsx
  screens/
    Home.tsx  Windows.tsx  Scenes.tsx  Editor.tsx
    Modules.tsx  ModuleDetail.tsx  CreateModule.tsx  Workshop.tsx
    Profiles.tsx  ProfileDetail.tsx  AddPhotos.tsx  NewProfile.tsx
    Settings.tsx
    dev/ Radar.tsx  Camera.tsx  Comms.tsx
  data/
    store.ts            // STORE katalog, seed scény/profily/drafty
  hooks/
    useTask.ts  useAgent.ts  useClock.ts
```

**Router:** jednoduchý — `screen` ze store renderuje příslušnou `screens/*`. `groupOf(screen)` určuje aktivní tab. Žádné URL nutné, ale lze namapovat.

---

## 14. Co nahradit reálnou logikou (prototyp je fake)

| Prototyp (simulace) | Produkce |
|---|---|
| `startTask` fake progress | Reálný progress instalace/tréninku přes API/WS |
| AI agent 4-krokový timeout | Reálné LLM volání (streamovaný status) |
| `search` nad 16 widgety, „1412" | Reálný MagicMirror registry / backend search |
| `connState` scan s fake IP | Reálný mDNS/network scan zrcadla |
| MQTT presety (comms) | Reálný MQTT broker zrcadla |
| Kamera/fotky (barevné gradienty) | Reálný feed kamery zrcadla + upload |
| `time` lokální | Čas/data ze zrcadla |
| Stav v paměti | Persistence (backend / localStorage) + sync se zrcadlem |

**Zachovej beze změny:** všechny vizuální stavy, loading skeletony, progress pruhy, optimistické UI updaty, toasty, draft/apply model, held/selected logiku, kontinuitu tabů.

---

## 15. Reference

V projektu jsou screenshoty všech obrazovek ve složce `screenshots/` (home, scenes, editor, zone, dev, comms, radar, settings, profile, taskbar, modaly). Použij je jako vizuální pravdu vedle tohoto dokumentu. Živý prototyp: `Mirror Control.dc.html`.

**Do / Don't** (estetika):
- ✅ Ploché krémové povrchy, vlasové linky, mono pro labely/čísla, tmavé invertované panely pro „zrcadlo".
- ✅ Červená jen pro aktivní/vybrané + Apply alert; žlutá jen pro držené/highlight.
- ❌ Žádné stíny (kromě rámu), gradienty (kromě backdropu), barevné výplně obsahu.
- ❌ Nevnořovat tab stripy do tab stripů — navigace je plochý spodní bar.
- ❌ Nemíchat významy červené a žluté.
```
