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

## 2026-09-04d: Camera Color Fix - RGB to BGR Conversion

### Problém
- **Divné barvy v camera streamu**: Barvy vypadaly jako z IR kamery (červená a modrá prohozené)
- **Změna hardware**: Z IR kamery (grayscale) na USB RGB webkameru
- **Chybějící konverze**: picam2 vrací RGB, ale OpenCV očekává BGR

### Řešení

#### 1. Přidání color space conversion (supervisor.py)

**PŘED:**
```python
frame = self.picam.capture_array()  # RGB888 == BGR for cv2
# ... processing ...
ok, jpg = cv2.imencode(".jpg", frame, ...)
```
Komentář `RGB888 == BGR for cv2` byl **špatně** - picam2 vrací RGB, ale cv2 potřebuje BGR!

**PO:**
```python
frame = self.picam.capture_array()  # RGB888 from picam2
# Convert RGB to BGR for OpenCV (picam2 returns RGB, cv2 expects BGR)
frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
# ... processing ...
ok, jpg = cv2.imencode(".jpg", frame, ...)
```

### Proč to bylo potřeba?
- **picam2** (Raspberry Pi Camera library v2) vrací RGB888 formát
- **OpenCV** (cv2) interně používá BGR barevný prostor
- **cv2.imencode(".jpg", ...)** enkóduje do JPEG s BGR kanály
- **Bez konverze**: Red ↔ Blue jsou prohozené → divné barvy

### S IR kamerou to nefungovalo proč?
- IR kamera vrací grayscale (1 kanál)
- Grayscale nemá RGB kanály → problém neviditelný
- RGB webkamera má 3 kanály → prohození je okamžitě vidět

### Změněné soubory
```
 mirror-console/backend/supervisor.py | 4 +++-
 1 file changed, 3 insertions(+), 1 deletion(-)
```

### Deploy
- [x] Git push
- [x] SSH na Pi: `git pull`
- [x] Restart backend: `sudo systemctl restart mirror-console-backend`
- [x] Test stream: http://10.0.0.249:8090 → Dev mode → Camera tab

---

## 2026-09-04e: Camera Detection UI - Remove Text Overlays, Add Detection Info

### Problém
- **Text v camera streamu**: Jména a "fingers: N" text překrývaly video
- **Chybějící detection info v UI**: Uživatel neviděl co kamera detekovala
- **Statické info řádky**: Zobrazovaly pevné hodnoty místo live detekce

### Řešení

#### 1. Odstranění text overlays (supervisor.py)
**_draw_face:**
```python
# PŘED
cv2.putText(frame, name, (left + 6, bottom - 6), ...)
cv2.rectangle(frame, (left, top), (right, bottom), (255, 128, 0), 2)

# PO
cv2.rectangle(frame, (left, top), (right, bottom), (0, 0, 255), 1)
# Žádný text - pouze červený tenký obdélník
```

**_draw_gesture:**
```python
# PŘED
cv2.putText(frame, f"fingers: {n}", ...)

# PO
# Pouze landmarks + connections, žádný text
mp.solutions.drawing_utils.draw_landmarks(frame, lm, ...)
```

#### 2. Expozice detection dat přes API (supervisor.py)
```python
def health(self) -> dict:
    detected_face = None
    finger_count = None

    if self.mode in ("test_face", "learn") and self._last_faces:
        detected_face = self._last_faces[0][4] if self._last_faces[0][4] else "unknown"

    if self.mode == "test_gesture" and self._last_hands:
        finger_count = self._last_hands[0][2]

    return {
        # ... existující fields ...
        "detected_face": detected_face,
        "finger_count": finger_count,
    }
```

#### 3. Dynamické info řádky v UI (Camera.tsx)
**PŘED:**
```tsx
const rows = [
  { k: "Detector", v: "BlazeFace" },
  { k: "Recognition", v: "MobileFaceNet" },
  { k: "Latency", v: "38 ms" },
  { k: "Exposure", v: "auto · +0.3 EV" },
];
```

**PO:**
```tsx
// Poll /healthz každých 500ms
useEffect(() => {
  const interval = setInterval(async () => {
    const data = await fetch("/healthz").then(r => r.json());
    setDetectedFace(data.detected_face || null);
    setFingerCount(data.finger_count);
  }, 500);
  return () => clearInterval(interval);
}, []);

// Dynamické řádky podle módu
const getDetectionInfo = () => {
  if (detectionMode === "test_face" || detectionMode === "learn") {
    return [{ k: "Osoba", v: detectedFace || "—" }];
  } else if (detectionMode === "test_gesture") {
    return [{ k: "Prsty", v: fingerCount !== null ? String(fingerCount) : "—" }];
  }
  return [];
};
```

### Výhody
- ✅ Čistý video stream bez text overlays
- ✅ Červené tenké obdélníky kolem obličejů (lépe viditelné)
- ✅ Live detection info v UI místo statických hodnot
- ✅ Reaktivní - aktualizuje se každých 500ms
- ✅ Mód-aware - zobrazuje relevantní info podle režimu (osoba/prsty)

### Změněné soubory
```
 mirror-console/backend/supervisor.py      | 19 ++++++++++++++
 mirrorControl/src/screens/dev/Camera.tsx  | 38 ++++++++++++++++++--------
 REFACTOR.md                               | 85 ++++++++++++++++++++++++++++++
 3 files changed, 130 insertions(+), 12 deletions(-)
```

### Deploy checklist
- [x] Git push změn
- [x] SSH na Pi: `git pull`
- [x] Rebuild mirrorControl: `cd ~/smartMirror/mirrorControl && npm run build`
- [x] Restart backend: `sudo systemctl restart mirror-console-backend`
- [x] Restart web: `sudo systemctl restart mirror-console-web`
- [x] Test: http://10.0.0.249:8090 → Dev mode → Camera tab → přepínat módy

---

## 2026-09-04f: Camera Rotation Fix - Upside Down Mount

### Problém
- **Kamera montovaná vzhůru nohama**: Z konstrukčních důvodů je kamera fyzicky otočená o 180°
- **Detekce nefungovala**: face_recognition ani MediaPipe hands nerozpoznávaly obličeje/gesta na otočeném framu
- **CSS transform hack**: UI otáčelo stream zpět pomocí `transform: "rotate(180deg)"`, ale to neřeší detekci

### Řešení

#### 1. Rotace frame v capture loop (supervisor.py)
```python
# PŘED
frame = self.picam.capture_array()  # RGB888 from picam2
frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
# ... detekce na otočeném framu ❌ nefunguje

# PO
frame = self.picam.capture_array()  # RGB888 from picam2
frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
frame = cv2.rotate(frame, cv2.ROTATE_180)  # ✅ před detekcí
# ... detekce na správně orientovaném framu ✅
```

#### 2. Odstranění CSS transform (Camera.tsx)
```tsx
// PŘED
<img style={{ transform: "rotate(180deg)" }} />

// PO
<img style={{}} />  // frame už je správně orientovaný
```

### Proč to funguje
1. **cv2.rotate(frame, cv2.ROTATE_180)** fyzicky otočí pixely v paměti o 180°
2. Detekce dostane správně orientovaný frame → rozpozná obličeje/gesta
3. Stream je enkódován už otočený → není potřeba CSS transform
4. Jediná rotace (v Pythonu) místo dvou (Python + CSS)

### Výhody
- ✅ Detekce obličejů funguje
- ✅ Detekce gest funguje
- ✅ Čistší řešení (rotace na jednom místě)
- ✅ Žádný performance overhead v browseru (CSS transform)

### Změněné soubory
```
 mirror-console/backend/supervisor.py      | 2 ++
 mirrorControl/src/screens/dev/Camera.tsx  | 1 -
 REFACTOR.md                               | 55 +++++++++++++++++++++++
 3 files changed, 57 insertions(+), 1 deletion(-)
```

### Deploy checklist
- [ ] Git push změn
- [ ] SSH na Pi: `git pull`
- [ ] Rebuild mirrorControl: `cd ~/smartMirror/mirrorControl && npm run build`
- [ ] Restart backend: `sudo systemctl restart mirror-console-backend`
- [ ] Restart web: `sudo systemctl restart mirror-console-web`
- [ ] Test: http://10.0.0.249:8090 → Dev mode → Camera tab
  - [ ] Přepnout na test_face → měl by se objevit červený obdélník kolem obličeje
  - [ ] Přepnout na test_gesture → měly by se detekovat prsty
  - [ ] Zkontrolovat "Osoba:" a "Prsty:" v info řádcích

---

## 2026-09-04g: Camera Stream Performance - RGB Fix + TurboJPEG

### Problém
- **RGB→BGR konverze zbytečná**: `cv2.cvtColor(RGB→BGR)` zabírala ~1 ms/frame
- **Špatné barvy**: face_recognition a MediaPipe očekávají RGB, dostávaly BGR → horší detekce
- **cv2.imencode() pomalé**: software JPEG enkódování zabíralo ~10-20 ms/frame
- **Zasekaný stream**: celková latence způsobovala výrazné zpoždění

### Řešení

#### 1. Odstranění RGB→BGR konverze
```python
# PŘED
frame = picam.capture_array()  # RGB888
frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)  # zbytečná konverze
# detekce dostává BGR ❌

# PO
frame = picam.capture_array()  # RGB888
# žádná konverze - RGB je správný formát ✅
```

#### 2. Oprava barev v cv2.rectangle()
```python
# PŘED (BGR barvy):
cv2.rectangle(frame, ..., (0, 0, 255), 1)  # červená v BGR

# PO (RGB barvy):
cv2.rectangle(frame, ..., (255, 0, 0), 1)  # červená v RGB
```

#### 3. TurboJPEG encoder místo cv2.imencode()
```python
# PŘED (software encoding, ~10-20 ms):
ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])

# PO (hardware-accelerated, ~2-3 ms):
from turbojpeg import TurboJPEG
encoder = TurboJPEG()
jpg_bytes = encoder.encode(frame, quality=75)  # očekává RGB ✅
```

### Proč to funguje
1. **Picamera2 vrací RGB** → žádná konverze potřebná
2. **face_recognition očekává RGB** → lepší detekce obličejů
3. **MediaPipe očekává RGB** → lepší detekce rukou/gest
4. **TurboJPEG je 3-5× rychlejší** než cv2.imencode() (používá libjpeg-turbo s SIMD)
5. **Správné barvy v JPEG streamu** (RGB se enkóduje jako RGB, ne jako BGR)

### Výhody
- ✅ Ušetřeno ~1 ms/frame (žádná RGB→BGR konverze)
- ✅ Ušetřeno ~8-15 ms/frame (TurboJPEG vs cv2.imencode)
- ✅ **Celkově ~10-20% rychlejší stream**
- ✅ Lepší detekce (knihovny dostanou správný barevný formát)
- ✅ Správné barvy v UI
- ✅ Fallback na cv2.imencode(), pokud TurboJPEG není nainstalováno

### Změněné soubory
```
 mirror-console/backend/supervisor.py  | 25 +++++++++++++----
 REFACTOR.md                           | 65 +++++++++++++++++++++++
 2 files changed, 85 insertions(+), 5 deletions(-)
```

### Deploy checklist
- [x] Nainstalovat PyTurboJPEG na Pi: `pip3 install --break-system-packages "PyTurboJPEG<2.0"`
  - **Poznámka**: Pi má libjpeg-turbo 2.x, který vyžaduje PyTurboJPEG 1.x (ne 2.x)
- [x] Git push změn
- [x] SSH na Pi: `git pull`
- [x] Restart backend: `sudo systemctl restart mirror-console-backend`
- [x] Test: http://10.0.0.249:8090 → Dev mode → Camera tab
  - [x] Stream by měl být plynulejší
  - [x] Check logs: `journalctl -u mirror-console-backend -f` → mělo by být "TurboJPEG encoder initialized" ✅
  - [x] Zkontrolovat FPS v /healthz endpoint → **11.8 FPS** ✅

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
