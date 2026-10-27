# MQTT migration — stav a plán pro frontend

**Datum:** 2026-10-20 · **Branch:** `refactor-be` · **Necommitnuto**

Tento dokument je samostatný handoff: backend je hotový, frontend se nedotkl.
Čti ho jako jediný vstupní bod — nic z předchozí konverzace není potřeba.

---

## 1. Kontext: co se stalo předtím

Na branchi `refactor-be` proběhl velký backend refactor (`camera/` + `ld2450/`
+ `display_control/` + `mirror-console/` → jeden `backend/` s pěti feature
složkami; `mirrorControl/` → `frontend/`). Detaily v
`BACKEND-REFACTOR-SUMMARY.md` a `REFACTOR.md`.

Ten refactor nechal komunikaci appka↔backend na **HTTP REST** (gateway na
`:8000`), i když zadání bylo převést vše na MQTT. Spec to povolil jako
"odchylku č. 3" — bylo to proti zadání. **Tato migrace to napravuje.**

## 2. Co je hotové (backend)

**33 RPC endpointů na MQTT.** Každá JSON operace, kterou backend měl na HTTP,
je teď MQTT request/reply. Včetně těch, co jsem původně nedoporučoval
(catalog, readme, layout) — zadání bylo "bez výjimek".

Implementace je jedna, v `backend/shared/mqtt_client.py` →
`MqttClient.serve(topic, handler)`.

### Protokol

Mosquitto na Pi je **v3.1.1**, takže response topic jde **v payloadu**, ne
v MQTT 5 hlavičce:

```
publish → <endpoint>     {"_rid": "<uuid>", "_reply": "<tvůj topic>", ...args}
receive ← <tvůj topic>   {"_rid": "<uuid>", "ok": true,  ...result}
                         {"_rid": "<uuid>", "ok": false, "error": "...",
                          "status": 404|409|500}
```

- `_rid` koreluje odpovědi — jeden reply topic zvládne víc requestů naráz.
- `status` je původní HTTP status. **Appka na něm větví** (finalize 409 →
  nabídni overwrite), proto musí přes drát přežít.
- Bez `_reply` = fire-and-forget, backend neodpovídá.
- Handlery běží každý ve svém threadu — pomalý nezablokuje ostatní.

### Další změny v backendu

- **`radar/service` + `radar/status`** dodělané (byly to mrtvé konstanty,
  deklarované a nepoužité). HTTP `/radar` tím zmizel z camera feature.
- **Install progress se pushuje retained** (`modules/install/progress/<type>`)
  místo pollování `/store/install/status`.
- **Hot-load do MagicMirror jádra jde MQTT** (`smartmirror/core/hot-load` →
  `…/result`, obsluha v `MagicMirror/js/profile.js`). Tím **nezbyl žádný
  backend→core HTTP hop**; `paths.MM_BASE_URL` je nepoužitý (nechán, je to
  líná env položka, nic nestojí).
- **AI agent stream** je per-session topic místo SSE
  (`modules/ai/stream/<scope>/<name>`), se **stejnými event objekty**.
- **Retained topicy se primují při startu** (`camera/service.py` volá
  `api.api_state["publish_initial_state"]()`). Bez toho se `camera/profiles`
  a `radar/status` publikovaly až při zavolání RPC — na čerstvém brokeru by
  tedy subscriber nenašel nic a appka by musela pollovat dál. Ověřeno:
  subscriber připojený **po** startu dostane všechny čtyři hodnoty.

### Dvě chyby nalezené a opravené při tom

1. **Leak handlerů v `_hot_load`** (`features/scenes/api.py`) — subscriboval
   při každém Apply, takže po 3 Apply byly 3 handlery a každý reagoval i na
   pozdější odpovědi. Teď jedna dlouhoživá subscription + registr podle
   `moduleId`. Regrese: `features/scenes/test_hot_load.py`.
2. **Unhandled rejection v `_onHotLoad`** (`MagicMirror/js/profile.js`) —
   `async` metoda volaná ze synchronního try/catch. Ozávorkované i `publish`.

### Verifikace (ne jen "testy prošly")

Pustil jsem **skutečný mosquitto broker** a odzkoušel end-to-end:

| Co | Výsledek |
|---|---|
| Unit suite (`cd backend && pytest`) | **147 passed** (117 baseline + 30 nových) |
| RPC layer vs. reálný broker | 6/6 — status, concurrence, fire-and-forget, odolnost proti garbage payloadu |
| scenes + modules + AI e2e | 21/21 |
| camera e2e (stub hardware) | 10/10 |
| hot-load e2e | 9/9 — **včetně mlčícího jádra**: selže nahlas a spadne na pm2 restart, netváří se jako úspěch |
| Boot služeb, core JS `node --check`, FE `tsc --noEmit` | ok |

Nové testy v repu: `backend/shared/test_mqtt_rpc.py` (8),
`backend/features/test_transports.py` (16, hlídá že se transporty nerozejdou),
`backend/features/scenes/test_hot_load.py` (6).

## 3. Klíčový fakt: appka zatím funguje nezměněná

HTTP JSON routy jsem **nechal jako shim nad stejnými handlery** — jedna
implementace, dva transporty. Proto `npx tsc --noEmit` prochází, aniž jsem se
frontendu dotkl.

**Důsledek pro migraci:** jde dělat obrazovku po obrazovce, a každý krok je
zvlášť revertovatelný. Není to all-or-nothing.

`backend/features/test_transports.py` drží oba transporty u sebe — když někdo
přidá HTTP routu bez RPC topicu (nebo naopak), test spadne.

---

## 4. Co je potřeba udělat ve frontendu

### Výchozí stav

| Soubor | Co teď dělá |
|---|---|
| `frontend/src/services/mqtt.ts` | připojení k brokeru, `TOPICS`, `publish()`. Subscribuje **`smartmirror/#`** (všechno) |
| `frontend/src/services/mirrorBridge.ts` | jediný `onMessage` → fan-out do Redux |
| `frontend/src/services/api.ts` | **všechna REST volání** — tohle se z většiny smaže |

**Důležité pro design `rpc()`:** appka už subscribuje `smartmirror/#` a má
jeden centrální `onMessage` v `mirrorBridge.ts`. Reply topicy tedy budou
chodit **do toho existujícího handleru** — `rpc()` se musí zapojit tam
(nebo si vzít vlastní listener na clientovi), ne přidávat per-call subscribe.
Per-call subscribe by navíc racoval s odpovědí a leakoval handlery (stejná
chyba, jakou jsem opravoval na backendu).

### Doporučený tvar helperu

```ts
// frontend/src/services/mqtt.ts
const REPLY_TOPIC = `smartmirror/app/${clientId}/reply`;

export async function rpc<T>(
  endpoint: string,
  args: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<T>
```

Mechanika: `_rid` = `crypto.randomUUID()`, ulož `resolve/reject` do Map,
publikuj `{_rid, _reply: REPLY_TOPIC, ...args}`, v `onMessage` na
`REPLY_TOPIC` najdi podle `_rid` a vyřeš. Vždy timeout — `ok:false` převeď na
`throw` s `status`, aby `try/catch` v obrazovkách fungoval jako u fetch.

**Timeouty:** default 10 s nestačí dvěma věcem — `layout/apply` (hot-load čeká
až 15 s) a `install` (minuty, ale ten vrací hned a progress chodí push).

---

## 5. Mapa endpointů (nahrazuje `services/api.ts`)

### camera — `smartmirror/camera/rpc/…`
| bylo | teď | args |
|---|---|---|
| `GET /healthz` | `…/health` | — (nebo retained `camera/state`) |
| `GET /mode` | `…/mode/get` | — (nebo retained `camera/mode`) |
| `POST /mode` | `…/mode/set` | `{mode}` |
| `POST /resolution` | `…/resolution` | `{width,height}` |
| `GET /dataset` | `…/dataset/list` | `{name}` |
| `DELETE /dataset` | `…/dataset/delete` | `{name,file}` |
| `POST /capture` | `…/capture` | `{name,file?}` |
| `POST /encode` | `…/encode` | `{name\|null}` |
| `GET /profiles` | `…/profiles/list` | — (nebo retained `camera/profiles`) |
| `DELETE /profiles` | `…/profiles/delete` | `{name}` |

### radar — `smartmirror/radar/rpc/…`
| bylo | teď | args |
|---|---|---|
| `GET /radar` | `…/service/get` | — (nebo retained `radar/status`) |
| `POST /radar` | `…/service/set` | `{active}` |

Navíc `smartmirror/radar/service` bere `{active}` fire-and-forget.

### scenes — `smartmirror/scenes/rpc/…`
| bylo | teď | args |
|---|---|---|
| `GET /layout` | `…/layout/get` | — |
| `PUT /layout` | `…/layout/put` | store objekt **na top level** |
| `POST /layout/apply` | `…/layout/apply` | — (**pomalé**, hot-load ≤15 s) |
| `GET /modules` | `…/modules/get` | — |

> `layout/put` bere store rozprostřený do zprávy
> (`{_rid,_reply,defaults,windows,instances}`) — backend si envelope klíče
> odstraní sám.

### modules store — `smartmirror/modules/rpc/…`
| bylo | teď | args |
|---|---|---|
| `GET /store/catalog` | `…/catalog` | — |
| `GET /store/readme` | `…/readme` | `{id,url?}` |
| `POST /store/install` | `…/install` | `{id}` |
| `GET /store/install/status` | `…/install/status` | `{id}` — **radši push níž** |
| `POST /store/uninstall` | `…/uninstall` | `{name}` |

**Přestat pollovat install status.** Subscribuj
`smartmirror/modules/install/progress/<type>` (retained per typ) +
`install/started`, `install/done`, `install/failed`, `uninstalled`.

### AI builder — `smartmirror/modules/ai/rpc/…`
| bylo | teď | args |
|---|---|---|
| `GET /api/modules/ai-status` | `…/status` | — |
| `GET /api/modules/list` | `…/list` | — |
| `POST /api/modules/draft` | `…/draft/create` | `{name,description}` |
| `GET /api/modules/draft` | `…/draft/get` | `{name}` |
| `GET /api/modules/session` | `…/session` | `{name,scope}` |
| `POST /api/modules/chat` | `…/chat` | `{name,scope,message}` |
| `POST /api/modules/edit/open` | `…/edit/open` | `{name}` |
| `POST /api/modules/edit/prepare` | `…/edit/prepare` | `{name}` |
| `POST /api/modules/adopt` | `…/adopt` | `{name}` |
| `POST /api/modules/edit/restart` | `…/restart` | — |
| `POST /api/modules/finalize` | `…/finalize` | `{name,overwrite}` |

**Agent stream** (`EventSource` → subscribe):
`smartmirror/modules/ai/stream/<scope>/<name>` nese **stejné event objekty**
jako SSE (`{type:"connected"|"text"|"tool"|"error"|"done", …}`), takže
`AiEvent` handling se přenese 1:1. Subscribuj **před** voláním `…/chat`,
unsubscribuj při unmountu.

> Stream **není retained** — co proletí, když nejsi subscribed, je ztracené
> (stejně jako u SSE). Transcript se dotáhne přes `…/session` při otevření.

---

## 6. Co zůstává na HTTP (nemigrovat)

Tohle dál jede `fetch` / `<img>` / `<iframe>` proti gateway `:8000`:

- `/stream.mjpg` — MJPEG `<img src>`
- `/photo?name=&file=` — `<img src>`
- `/module-assets/*` — screenshoty ve store
- `/module-draft/<name>/demo.html`, `/module-installed/<name>/demo.html` —
  preview `<iframe>`

**Cíl "žádné HTTP" není dosažitelný** — binárky a streamy by znamenaly
chunkovat do topicu, což je antipattern. Dosažitelné (a dosažené na backendu)
je "HTTP jen pro binárky a streamy".

---

## 7. Pořadí práce (od nejmenšího rizika)

1. **Smazat redundantní pollování.** `/healthz`, `GET /mode`,
   `GET /profiles`, `GET /radar` už mají retained topicy
   (`camera/state`, `camera/mode`, `camera/profiles`, `radar/status`) →
   **čistá delece, žádný nový kód.** Tímhle začít.
   Hodnoty existují od startu unitu (viz priming výš), takže se na ně dá
   spolehnout i když se appka připojí později. Pozor: `camera/profiles` se
   aktualizuje při každém `profiles/list` a `profiles/delete`, takže po
   smazání profilu je retained hodnota svěží — není potřeba refetch.
2. **Postavit `rpc()`** v `services/mqtt.ts` (reply topic + `_rid` dispatch +
   timeout), zapojit do `mirrorBridge.ts`. Všechno dál to potřebuje.
3. **Fire-and-forget příkazy:** mode/set, resolution, radar service,
   dataset/profile delete, encode.
4. **Install flow:** přepnout na pushovaný progress, zahodit polling loop.
5. **Scenes editor:** layout get/put/apply, modules/get.
6. **Store:** catalog + readme.
7. **AI builder** — **naposled**, má nejvíc pohyblivých částí (busy 409, rev
   countery, finalize overwrite, stream subscribe/unsubscribe).

Po každém kroku HTTP twin pořád existuje → chyba je revertovatelná po
obrazovkách.

---

## 8. Až bude appka hotová (úklid backendu)

1. Smazat `router.add(...)` twin bloky:
   - `backend/features/camera/api.py` — `_mount_http` si nechá **jen**
     `/stream.mjpg` + `/photo`
   - `backend/features/scenes/api.py` — všechny čtyři; scenes pak nepotřebuje
     **žádné HTTP**, takže `scenes-api` může přijít o port
   - `backend/features/modules/api.py`
   - `backend/features/modules/ai_builder.py` — statické stromy nechat; SSE
     routa a `_Session.sse` / `_sse_send` můžou jít
2. Zúžit `ROUTES` v `backend/gateway.py` na binární/statické prefixy.
3. Upravit `backend/features/test_transports.py` — **tvrdí, že twiny
   existují**, takže po smazání bude padat (záměrně: je to pojistka proti
   nechtěnému smazání).

---

## 9. Příkazy

```bash
# backend testy (hardware-free, běží i bez Pi)
cd backend && python3 -m pytest              # 147 testů
python3 -m pytest features/test_transports.py   # parita transportů

# frontend
cd frontend && npx tsc --noEmit && npm run build

# nasazení (Pi je source of truth, deploy = git pull)
# na Pi: cd ~/smartMirror && ./deploy.sh
```

**Pozor na nasazení:** backend refactor přejmenoval systemd unity, takže
první nasazení téhle branche potřebuje `./deploy.sh --full` a **ruční smazání
starých unitů předem** (kolidovaly by o porty). Postup je v
`docs/superpowers/plans/2026-10-20-backend-refactor-report.md`.
