# MQTT Integration Testing

Testovací příkazy pro ověření MQTT komunikace mezi radarem, face recognition a MagicMirror.

## Prerekvizity

1. **Mosquitto broker běží:**
   ```bash
   sudo systemctl status mosquitto
   # Mělo by být: active (running)
   ```

2. **MagicMirror běží:**
   ```bash
   pm2 list
   # MMM-Profile bude subscribovat MQTT topics
   ```

3. **Sledování MQTT provozu (volitelné, užitečné pro debugging):**
   ```bash
   # Terminál 1: sleduj všechny MQTT zprávy
   mosquitto_sub -h 127.0.0.1 -t '#' -v
   ```

---

## Test 1: MMM-Profile MQTT Subscriber

Ověříme, že MMM-Profile přijímá a zpracovává MQTT zprávy.

### 1.1 Simulace "presence" (radar detekuje přítomnost)

```bash
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'present'
```

**Očekávané chování:**
- MMM-Profile přejde do stavu **"scanning"** (rotující kroužek, tečky)
- Status text: "Skenování obličeje…"
- V `pm2 logs MagicMirror` uvidíš:
  ```
  [MMM-Profile] MQTT message: smartmirror/radar/presence present
  ```

### 1.2 Simulace rozpoznání uživatele "Domes"

```bash
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/camera/recognition' -m '{"user":"Domes"}'
```

**Očekávané chování:**
- MMM-Profile přejde do stavu **"user"** s uživatelem "Domes"
- Animace: checkmark (✓), zelený avatar, jméno "Domes"
- Status text: "Obličej rozpoznán"
- Layout se změní podle aktuálního časového okna (morning/work/evening/weekend/night)
- Moduly se přesunou na správné pozice a zobrazí/skryjí podle pages.js
- V logách:
  ```
  [MMM-Profile] MQTT message: smartmirror/camera/recognition {"user":"Domes"}
  ```

### 1.3 Simulace nerozpoznaného obličeje

```bash
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/camera/recognition' -m '{"user":null}'
```

**Očekávané chování:**
- MMM-Profile přejde do stavu **"user"** s default uživatelem
- Animace: červený X cross
- Status text: "Obličej nerozpoznán"
- Layout pro "default" uživatele (podle pages.js - pouze weather_current)

### 1.4 Simulace "absence" (radar nedetekuje nikoho)

```bash
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'absent'
```

**Očekávané chování:**
- MMM-Profile přejde do stavu **"dimming"** (drží předchozí UI)
- Po 60 sekundách (dimTimeoutMs) přejde do **"asleep"**
- V "asleep": všechny moduly zmizí, obrazovka prázdná
- V logách:
  ```
  [MMM-Profile] MQTT message: smartmirror/radar/presence absent
  ```

---

## Test 2: Face Recognition s MQTT

Ověříme, že face_reco_once.py správně publikuje MQTT zprávy.

### 2.1 Test s --preview (otestuje kameru i MQTT)

```bash
cd ~/smartMirror/camera
python3 face_reco_once.py --preview --max-duration 5
```

**Co se stane:**
1. Otevře se okno s live preview z kamery
2. Script skenuje 5 sekund
3. Pokud rozpozná "Domes" → publish `{"user": "Domes"}`
4. Pokud nerozpozná → publish `{"user": null}`
5. MMM-Profile by měl zareagovat (viz Test 1.2 nebo 1.3)

**V logách:**
```
INFO face_reco: Scanning for faces (max 5.0s)...
INFO face_reco: Recognized Domes after 2.3s (8 frames)
INFO face_reco: MQTT published: smartmirror/camera/recognition -> {"user": "Domes"}
```

### 2.2 Test bez preview (produkční režim)

```bash
python3 face_reco_once.py
# Skenuje 10 sekund (default), publikuje výsledek
```

---

## Test 3: End-to-End Flow Simulation

Kompletní simulace celého workflow bez reálného radaru:

```bash
# 1. Radar detekuje přítomnost
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'present'
sleep 1  # MMM-Profile přejde do "scanning"

# 2. Face recognition běží (simulace úspěchu)
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/camera/recognition' -m '{"user":"Domes"}'
sleep 2  # MMM-Profile zobrazí Domes layout

# 3. Uživatel odejde
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'absent'
# Počká 60s, pak přejde do "asleep"
```

**Nebo jako one-liner pro rychlý test:**
```bash
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'present' && \
sleep 1 && \
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/camera/recognition' -m '{"user":"Domes"}' && \
sleep 5 && \
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'absent'
```

---

## Test 4: Re-entry During Dim Window

Test že pokud se vrátíš během dimming stavu, mirror pokračuje s tvým profilem.

```bash
# 1. Aktivace s Domes
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'present'
sleep 1
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/camera/recognition' -m '{"user":"Domes"}'
sleep 2

# 2. Odejití (dimming)
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'absent'
sleep 5  # Ještě pořád v dimming (max 60s)

# 3. Návrat BĚHEM dimming window (< 60s)
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'present'
```

**Očekávané chování:**
- Přejde přímo do "user" s "Domes" (ne do "scanning"!)
- Dimming timer se zruší
- Layout Domes zůstane aktivní
- Face recognition se NESPUSTÍ (protože je to re-entry)

---

## Debugging

### Sledování pm2 logů

```bash
pm2 logs MagicMirror --lines 50
# Nebo filtrovat jen MMM-Profile:
pm2 logs MagicMirror | grep MMM-Profile
```

### Sledování MQTT zpráv live

```bash
# Všechny topics
mosquitto_sub -h 127.0.0.1 -t '#' -v

# Jen radar presence
mosquitto_sub -h 127.0.0.1 -t 'smartmirror/radar/presence' -v

# Jen face recognition
mosquitto_sub -h 127.0.0.1 -t 'smartmirror/camera/recognition' -v
```

### Reset do "asleep" stavu

```bash
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'absent'
# Počkej 60s nebo restartuj MagicMirror:
pm2 restart MagicMirror
```

---

## Common Issues

### MMM-Profile nereaguje na MQTT zprávy

**Check:**
```bash
# 1. Je Mosquitto aktivní?
sudo systemctl status mosquitto

# 2. Je MagicMirror running?
pm2 list

# 3. Má MMM-Profile správnou MQTT config v config.js?
grep -A5 "MMM-Profile" ~/MagicMirror/config/config.js

# 4. Jsou v logách MQTT connection errors?
pm2 logs MagicMirror | grep -i mqtt
```

### Face recognition nepublikuje MQTT

**Check:**
```bash
# 1. Je paho-mqtt nainstalovaný?
python3 -c "import paho.mqtt.client; print('OK')"

# 2. Je Mosquitto dostupný?
mosquitto_pub -h 127.0.0.1 -t 'test' -m 'hello'
mosquitto_sub -h 127.0.0.1 -t 'test' -C 1

# 3. Spusť s debug výstupem:
cd ~/smartMirror/camera
python3 face_reco_once.py --preview 2>&1 | tee /tmp/face_reco.log
```

### Layout se nemění po rozpoznání

**Check:**
```bash
# Zkontroluj pages.js strukturu:
cat ~/MagicMirror/config/pages.js

# Zkontroluj aktuální čas vs. cron windows:
date
# Měl by spadat do nějakého from/to okna pro "Domes"

# Restart MagicMirror pro reload config:
pm2 restart MagicMirror
```

---

## Success Criteria

✅ **Test 1:** MMM-Profile správně přijímá MQTT zprávy a mění stavy
✅ **Test 2:** face_reco_once.py publikuje rozpoznaný/nerozpoznaný výsledek
✅ **Test 3:** End-to-end flow funguje: present → scanning → user → dimming → asleep
✅ **Test 4:** Re-entry během dimming drží stejný profil
✅ **Layout:** Moduly se správně zobrazují/skrývají a přesouvají podle pages.js
