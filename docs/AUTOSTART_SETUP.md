# Autostart Setup - Complete System

Návod pro nastavení automatického startu všech komponent Smart Mirror po restartu Raspberry Pi.

## Služby které se spustí automaticky

Po restartu Pi se automaticky spustí:

1. **Mosquitto** (systemd) - MQTT broker
2. **MagicMirror** (PM2) - zobrazení na obrazovce
3. **ld2450 daemon** (systemd) - radar presence detection + face recognition trigger

---

## 1. Mosquitto (MQTT Broker)

Už je nastaveno jako systemd service.

```bash
# Ověření
sudo systemctl status mosquitto
sudo systemctl is-enabled mosquitto  # Mělo by vypsat: enabled
```

---

## 2. MagicMirror (PM2)

### Setup autostart:

```bash
cd ~/MagicMirror

# Spusť MagicMirror s PM2 (pokud ještě neběží)
pm2 start npm --name "MagicMirror" -- start

# Ulož aktuální stav PM2
pm2 save

# Nastav PM2 autostart po restartu
pm2 startup

# PM2 vypíše příkaz který musíš spustit, bude vypadat nějak takto:
# sudo env PATH=$PATH:/home/admin/.nvm/versions/node/vXX.X.X/bin ...
# Zkopíruj a spusť ten příkaz!
```

### Ověření:

```bash
pm2 list
# Měl bys vidět MagicMirror s status "online"

# Test autostartu:
sudo reboot
# Po restartu:
pm2 list
# MagicMirror by měl běžet
```

---

## 3. LD2450 Radar Daemon (systemd)

### Instalace service:

```bash
cd ~/smartMirror/ld2450

# Udělej install script spustitelný
chmod +x install_service.sh

# Spusť instalaci
./install_service.sh
```

**Nebo manuálně:**

```bash
# Zkopíruj service file
sudo cp ~/smartMirror/ld2450/ld2450.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable autostart
sudo systemctl enable ld2450

# Start now
sudo systemctl start ld2450

# Check status
sudo systemctl status ld2450
```

### Ověření:

```bash
# Je služba aktivní?
sudo systemctl status ld2450

# Je enabled pro autostart?
sudo systemctl is-enabled ld2450  # Mělo by vypsat: enabled

# Sleduj logy live:
sudo journalctl -u ld2450 -f
```

---

## Complete System Test

### Test 1: Všechny služby běží

```bash
# MQTT broker
sudo systemctl status mosquitto

# MagicMirror
pm2 list

# Radar daemon
sudo systemctl status ld2450
```

Všechny by měly být **active (running)** / **online**.

---

### Test 2: End-to-End Flow přes SSH

Simulace celého flow bez fyzického pohybu před radarem:

```bash
# Terminál 1: Sleduj radar daemon logy
sudo journalctl -u ld2450 -f

# Terminál 2: Sleduj MagicMirror logy
pm2 logs MagicMirror

# Terminál 3: Sleduj MQTT zprávy
mosquitto_sub -h 127.0.0.1 -t '#' -v

# Terminál 4: Simuluj presence detection
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'present'
```

**Co se stane:**
1. MMM-Profile přejde do "scanning" (rotující kroužek)
2. Radar daemon spustí face_reco_once.py (viz Terminál 1 logy)
3. Face recognition rozpozná uživatele nebo timeout
4. Publikuje `{"user": "Domes"}` nebo `{"user": null}` (viz Terminál 3)
5. MMM-Profile zobrazí výsledek (checkmark nebo X)

---

### Test 3: Manuální spuštění face recognition

```bash
# Spusť face recognition manuálně
cd ~/smartMirror/camera
python3 face_reco_once.py --preview --max-duration 10
```

**Očekávaný výsledek:**
- Okno s kamerou se otevře
- Rozpozná tě za ~2-5 sekund
- Publikuje MQTT zprávu
- MagicMirror ukáže zelený checkmark + "Domes"

---

### Test 4: Kompletní reboot test

```bash
# 1. Restart Pi
sudo reboot

# 2. Po restartu (přihlaš se přes SSH):
# Zkontroluj že všechny služby běží:

sudo systemctl status mosquitto
pm2 list
sudo systemctl status ld2450

# 3. Otestuj radar flow:
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'present'

# Měl by se spustit face recognition a MagicMirror zareagovat
```

---

## Debugging

### Radar daemon neběží

```bash
# Zkontroluj chyby v logách
sudo journalctl -u ld2450 -n 50

# Nejčastější problémy:
# 1. UART device neexistuje
ls -l /dev/ttyAMA0

# 2. Permission denied na /dev/ttyAMA0
sudo usermod -a -G dialout admin
# Pak logout/login nebo restart

# 3. MQTT broker není dostupný
sudo systemctl status mosquitto

# 4. Python dependencies chybí
python3 -c "import serial, paho.mqtt.client; print('OK')"
```

### Face recognition nefunguje

```bash
# Test kamery
python3 -c "from picamera2 import Picamera2; print('Camera OK')"

# Test face recognition s preview
cd ~/smartMirror/camera
python3 face_reco_once.py --preview --max-duration 5

# Zkontroluj encoded_faces.pickle
ls -l ~/smartMirror/camera/encoded_faces.pickle
```

### MagicMirror nereaguje na MQTT

```bash
# Sleduj PM2 logy
pm2 logs MagicMirror | grep -i mqtt

# Zkontroluj že MMM-Profile má mqtt package
ls ~/MagicMirror/modules/MMM-Profile/node_modules/ | grep mqtt

# Pokud NE:
cd ~/MagicMirror/modules/MMM-Profile
npm install
pm2 restart MagicMirror
```

---

## Startup Order

Po restartu Pi se služby spustí v tomto pořadí:

1. **Mosquitto** (systemd target: network.target)
2. **ld2450 daemon** (systemd, závisí na mosquitto)
3. **MagicMirror** (PM2, spustí se automaticky po přihlášení uživatele admin)

ld2450 daemon čeká na:
- MQTT broker (mosquitto)
- UART device (/dev/ttyAMA0)

MagicMirror (MMM-Profile) čeká na:
- MQTT broker (mosquitto)
- Display server (X11)

---

## Service Management Cheatsheet

### Mosquitto (MQTT)
```bash
sudo systemctl start|stop|restart mosquitto
sudo systemctl status mosquitto
sudo journalctl -u mosquitto -f
```

### LD2450 Radar Daemon
```bash
sudo systemctl start|stop|restart ld2450
sudo systemctl status ld2450
sudo journalctl -u ld2450 -f
```

### MagicMirror (PM2)
```bash
pm2 start|stop|restart MagicMirror
pm2 list
pm2 logs MagicMirror
pm2 monit
```

---

## Success Criteria

✅ Po `sudo reboot`:
1. Mosquitto běží: `sudo systemctl status mosquitto`
2. MagicMirror běží: `pm2 list`
3. ld2450 daemon běží: `sudo systemctl status ld2450`

✅ Po `mosquitto_pub ... presence present`:
1. MagicMirror zobrazí "Skenování obličeje…"
2. Radar daemon spustí face_reco_once.py (viditelné v journalctl)
3. Face recognition publikuje výsledek
4. MagicMirror zobrazí checkmark nebo X

✅ Celý systém funguje autonomně:
1. Někdo vstoupí do detekční zóny → radar detekuje
2. Display se zapne (GPIO17 relay pulse)
3. Face recognition běží automaticky
4. MagicMirror zobrazí správný profil
5. Po 60s absence → display se vypne
