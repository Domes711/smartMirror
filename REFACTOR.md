# Refactoring Log

Evidence větších refactorů a architektonických změn v projektu.

---

## 2026-09-04: Display Control Consolidation & Event-Driven Monitor UI

### Problém
- **Duplicitní daemony**: `display_control/` a `monitor-control/` dělaly téměř totéž
- **Legacy GPIO17**: starý kód pro fyzické tlačítko, které už není připojené
- **Polling místo events**: Monitor.tsx čekal pevně 4s místo MQTT subscription
- **Špatné topics**: Comms.tsx používal JSON payload místo prostých hodnot

### Řešení

#### 1. Sloučení daemon (display_control.py)
**Smazáno:**
- `monitor-control/` složka (celá)
  - `monitor_control.py` daemon
  - `setup.sh`, `README.md`, systemd service

**Rozšířeno `display_control/display_control.py`:**
- ✅ Brightness, Contrast (bylo)
- ✅ RGB gains (red, green, blue) - NOVĚ
- ✅ Color presets (5000K, 6500K, 7500K, 9300K, 10000K, User1, User2) - NOVĚ
- ✅ Display modes (Standard, Movie, Games) - NOVĚ
- ✅ Custom E2 feature (0-25) - NOVĚ
- ✅ State publishing na `smartmirror/display/state` (retained) - NOVĚ
- ❌ GPIO17 toggle - ODSTRANĚNO (starý displej)

**Topics (pod `smartmirror/display/`):**
- `control/power` - on/standby (DDC/CI)
- `control/brightness` - 0-100
- `control/contrast` - 0-100
- `control/rgb` - `{"r":0-100,"g":0-100,"b":0-100}`
- `control/preset` - 5000k/6500k/7500k/9300k/10000k/user1/user2
- `control/mode` - standard/movie/games
- `control/e2` - 0-25
- `control/get_state` - request state publish
- `smartmirror/display/state` - published state (JSON, retained)

#### 2. Vrácení Monitor.tsx screenu
- Obnoveno z git history
- Změna topics: `smartmirror/monitor/*` → `smartmirror/display/*`
- Přidáno do `App.tsx`, `shell.tsx`, `types/index.ts`
- Záložka "Monitor" v dev mode

#### 3. Event-driven refactor (Monitor.tsx)
**Před:**
```tsx
// Polling každých 30s
useEffect(() => {
  const interval = setInterval(loadState, 30000);
}, []);

// Timeout hack
publishDebounced → mqtt.pub → setTimeout(4000) → loadState()
```

**Po:**
```tsx
// Trvalá subscription na state topic
useEffect(() => {
  const handleStateUpdate = (topic, payload) => {
    setState(JSON.parse(payload));
  };
  mqtt.sub("smartmirror/display/state", handleStateUpdate);
  mqtt.pub("smartmirror/display/control/get_state", "1"); // initial
  return () => mqtt.unsub("smartmirror/display/state", handleStateUpdate);
}, []);

// Publish bez čekání - daemon publikuje → subscription zachytí
publishDebounced → mqtt.pub → daemon publishes → UI updates
```

**Výhody:**
- ✅ Reaktivní - UI se aktualizuje hned jak daemon publikuje
- ✅ Žádný polling - šetří MQTT traffic
- ✅ Event-driven - správný MQTT pattern
- ✅ Multi-client ready - když někdo jiný změní jas, všichni to vidí

#### 4. Oprava Comms.tsx
**Před:**
```tsx
{topic: "smartmirror/display/control", payload: '{"command":"power_on"}'}
{topic: "smartmirror/display/control", payload: '{"command":"brightness","value":75}'}
```

**Po:**
```tsx
{topic: "smartmirror/display/control/power", payload: "on"}
{topic: "smartmirror/display/control/brightness", payload: "75"}
```

#### 5. Dokumentace
- `display_control/README.md` - kompletní API reference (power, brightness, contrast, RGB, presets, modes, E2, state)
- `CLAUDE.md` - aktualizováno (display_control popis, odstraněny zmínky o monitor-control)

### Změněné soubory
```
 CLAUDE.md                                 |  81 ++++--
 display_control/README.md                 | 173 ++++++++---
 display_control/display_control.py        | 464 +++++++++++++++++-------------
 mirrorControl/src/App.tsx                 |   3 +-
 mirrorControl/src/components/shell.tsx    |   2 +-
 mirrorControl/src/screens/dev/Comms.tsx   |  14 +-
 mirrorControl/src/screens/dev/Monitor.tsx | 185 ++++++------
 mirrorControl/src/types/index.ts          |   2 +
 monitor-control/README.md                 | 134 ---------
 monitor-control/monitor-control.service   |  18 --
 monitor-control/monitor_control.py        | 245 ----------------
 monitor-control/setup.sh                  |  41 ---
 10 files changed, 566 insertions(+), 791 deletions(-)
```

### Deploy checklist
- [x] Git push změn
- [x] SSH na Pi: `git pull`
- [x] Restart display-control: `sudo systemctl restart display-control`
- [x] Rebuild mirrorControl: `cd ~/smartMirror/mirrorControl && npm run build`
- [x] Restart mirror-control: `sudo systemctl restart mirror-control`
- [x] Test MQTT: `mosquitto_sub -t smartmirror/display/state`
- [x] Test UI: http://10.0.0.249:8090 → Dev mode → Monitor tab

---

## 2026-09-04b: Monitor UI Improvements - Smooth Sliders & Power Status

### Problém
- **Slider lag**: Slider se nedal táhnout plynule, pouze cca 5 hodnot najednou
- **Problikávání**: Po kliknutí na novou hodnotu se problikla stará hodnota
- **Chybějící power state**: Panel stavu neukazoval jestli je display zapnutý nebo vypnutý
- **Špatný VCP kód**: Standby používal 0x05 místo správné 0x04

### Řešení

#### 1. Oprava VCP power kódů
**display_control.py:**
```python
# PŘED (nefungovalo)
POWER_MODES = {
    "on": "0x01",
    "standby": "0x05"  # ❌ nevalidní hodnota
}

# PO (funguje)
POWER_MODES = {
    "on": "0x01",      # DPM: On, DPMS: Off
    "standby": "0x04"  # DPM: Off, DPMS: Off  ✅
}
```

#### 2. Plynulé slidery (Monitor.tsx)
**PŘED:**
```tsx
// onChange i onInput volaly stejnou funkci → lag
<input onChange={(e) => on(parseInt(e.target.value))}
       onInput={(e) => on(parseInt(e.target.value))} />
// on() volalo setLocal + publishDebounced → blokovalo UI
```

**PO:**
```tsx
// Slider komponenta má oddělené onChange a onCommit
<Slider
  onChange={(v) => setLocalBrightness(v)}  // okamžitá změna UI
  onCommit={(v) => publishDebounced("brightness", v)}  // debounced MQTT
/>

// Input má správné rozdělení:
<input
  onInput={(e) => onChange(parseInt(e.target.value))}   // plynulé tažení
  onChange={(e) => onCommit(parseInt(e.target.value))}  // commit po puštění
/>
```

#### 3. Odstranění problikávání
**PŘED:**
```tsx
const [isChanging, setIsChanging] = useState(false);

// publishDebounced nastavila isChanging = true
// → blokovala sync ze serveru 1000ms
// → problikávání když server publikoval starou hodnotu

useEffect(() => {
  if (state && !isChanging) {  // ❌ blokovalo sync
    setLocalBrightness(state.brightness);
  }
}, [state, isChanging]);
```

**PO:**
```tsx
// Žádný isChanging flag
// onChange okamžitě mění lokální state
// onCommit triggeruje debounced publish
// Server state se syncne až když daemon publikuje novou hodnotu

useEffect(() => {
  if (state) {  // ✅ vždy sync
    setLocalBrightness(state.brightness);
  }
}, [state]);
```

#### 4. Zobrazení power state
**PŘED:**
```tsx
// Panel stavu: Brightness, Contrast, RGB (3 sloupce)
```

**PO:**
```tsx
// Panel stavu: Power, Brightness, Contrast, RGB (2x2 grid)
<div>
  <div>Power</div>
  <div style={{ color: state?.power === 1 ? C.green : C.mute }}>
    {state?.power === 1 ? "ON" : state?.power === 4 ? "STANDBY" : "—"}
  </div>
</div>
```

### Změněné soubory
```
 display_control/display_control.py        |  4 +-
 mirrorControl/src/screens/dev/Monitor.tsx | 87 ++++++++++-----------
 REFACTOR.md                               | 95 +++++++++++++++++++++++
 3 files changed, 140 insertions(+), 46 deletions(-)
```

### Jak to funguje teď
1. **Slider tažení**: `onInput` → okamžitá změna lokálního stavu (plynulé)
2. **Slider puštění**: `onChange` → debounced MQTT publish (300ms)
3. **Server update**: Daemon publikuje → MQTT subscription → sync lokálního stavu
4. **Žádné problikávání**: Lokální state se mění okamžitě, server state přijde až s novou hodnotou
5. **Power zobrazení**: Panel stavu ukazuje ON (zelená) / STANDBY (šedá)

### ⚠️ TODO: Opravit slider behavior
**Problém:** Slidery stále nefungují správně hlasně (smooth sliding není ideální).

**Co je špatně:**
- `onInput` + `onChange` separace není dostatečná
- Debouncing při slidingu způsobuje delay
- Server state sync může přepsat lokální hodnotu během tažení

**Potřebné řešení:**
- [ ] Přepracovat na controlled slider s lepší state management
- [ ] Možná použít `onMouseDown`/`onMouseUp` místo `onChange` pro detekci konce tažení
- [ ] Nebo použít `onPointerDown`/`onPointerUp` pro touch i mouse
- [ ] Zvážit optimistický update pattern (nesynovat ze serveru pokud je slider aktivní)

---

## 2026-09-04c: Monitor Updating Loader

### Problém
- **Chybějící feedback**: Po odeslání příkazu nebylo jasné jestli se něco děje
- **Nejistota**: Uživatel neví jestli čeká na odpověď nebo se příkaz ztratil

### Řešení

#### 1. Loading overlay (Monitor.tsx)
```tsx
const [isUpdating, setIsUpdating] = useState(false);

// Zapnout loader při publishu
const publishControl = (topic, value) => {
  setIsUpdating(true);  // ← loader ON
  publish(...);
};

const publishDebounced = (topic, value, delay) => {
  setTimeout(() => {
    setIsUpdating(true);  // ← loader ON po debounce
    publish(...);
  }, delay);
};

// Vypnout loader když přijde nový state
useEffect(() => {
  if (state) {
    setLocalBrightness(state.brightness);
    // ...
    setIsUpdating(false);  // ← loader OFF
  }
}, [state]);
```

#### 2. Overlay design
```tsx
{isUpdating && (
  <div style={{
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(255, 255, 255, 0.85)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10
  }}>
    <Spinner color={C.signal} track="#f3c9c0" size={24} />
    <span>Updating...</span>
  </div>
)}
```

### Jak to funguje
1. **User akce** (klikne power/změní slider/vybere preset)
2. **publishControl/publishDebounced** → `isUpdating = true` → loader se zobrazí
3. **MQTT round-trip**: client → broker → daemon → ddcutil → daemon → broker → client
4. **State update**: přijde nový state z daemonu → `isUpdating = false` → loader zmizí

**Výhody:**
- ✅ Jasný feedback pro uživatele
- ✅ Overlay blokuje interakci během update
- ✅ Vizuálně konzistentní se zbytkem appky (stejný Spinner jako v shell.tsx)
- ✅ Automaticky zmizí když přijde odpověď (event-driven)

---

## Template pro další refactory

### Problém
- Co bylo špatně?

### Řešení
- Co se změnilo?

### Změněné soubory
```
git diff --stat
```

### Deploy checklist
- [ ] Co je potřeba udělat na Pi?
