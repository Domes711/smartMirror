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
- [ ] Git push změn
- [ ] SSH na Pi: `git pull`
- [ ] Restart display-control: `sudo systemctl restart display-control`
- [ ] Rebuild mirrorControl: `cd ~/smartMirror/mirrorControl && npm run build`
- [ ] Restart mirror-control: `sudo systemctl restart mirror-control`
- [ ] Test MQTT: `mosquitto_sub -t smartmirror/display/state`
- [ ] Test UI: http://10.0.0.249:8090 → Dev mode → Monitor tab

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
