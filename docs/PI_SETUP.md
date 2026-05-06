# Raspberry Pi Setup Instructions

Návod pro nastavení MagicMirror a souvisejících služeb na Raspberry Pi.

## 1. PM2 Installation & MagicMirror Setup

### Instalace PM2 (process manager pro Node.js)

```bash
# Globální instalace PM2
sudo npm install -g pm2

# Ověření instalace
pm2 --version
```

### Spuštění MagicMirror s PM2

**IMPORTANT:** MagicMirror potřebuje DISPLAY environment variable pro zobrazení na obrazovce.
Použij ecosystem config file který zajistí správné nastavení.

```bash
# Zkopíruj PM2 config z repozitáře
cp ~/smartMirror/MagicMirror/pm2_magicmirror.config.js ~/MagicMirror/

# Spusť MagicMirror s PM2 ecosystem config
cd ~/MagicMirror
pm2 start pm2_magicmirror.config.js

# Ověření že běží
pm2 list

# Zobrazení logů
pm2 logs MagicMirror

# Restart
pm2 restart MagicMirror

# Stop
pm2 stop MagicMirror

# Automatické spuštění po restartu Pi
pm2 save
pm2 startup
# Spustí příkaz který PM2 vypíše (začíná "sudo env PATH=...")
# ZKOPÍRUJ A SPUSŤ TEN PŘÍKAZ!
```

**Pokud PM2 startup nefunguje (MagicMirror se nezobrazí po restartu):**

Problém: PM2 systemd service se spouští před X11/Wayland display serverem.

Alternativa - použij autostart.desktop:
```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/magicmirror.desktop <<EOF
[Desktop Entry]
Type=Application
Name=MagicMirror
Exec=/home/admin/.nvm/versions/node/v25.9.0/bin/pm2 resurrect
StartupNotify=false
Terminal=false
EOF
```

### PM2 Užitečné příkazy

```bash
pm2 list                    # Seznam běžících procesů
pm2 logs MagicMirror        # Live logy
pm2 logs MagicMirror --lines 100  # Posledních 100 řádků
pm2 monit                   # Monitoring (CPU, RAM)
pm2 restart MagicMirror     # Restart
pm2 stop MagicMirror        # Zastavit
pm2 delete MagicMirror      # Smazat z PM2 (nezruší instalaci)
pm2 save                    # Uložit aktuální seznam procesů
```

---

## 2. Mosquitto MQTT Broker

Již nainstalováno a běží jako systemd service.

```bash
# Status
sudo systemctl status mosquitto

# Start/Stop/Restart
sudo systemctl start mosquitto
sudo systemctl stop mosquitto
sudo systemctl restart mosquitto

# Logy
sudo journalctl -u mosquitto -f

# Test publish/subscribe
# Terminál 1:
mosquitto_sub -h 127.0.0.1 -t 'test' -v

# Terminál 2:
mosquitto_pub -h 127.0.0.1 -t 'test' -m 'hello world'
```

---

## 3. LD2450 Radar Daemon

Systemd service pro radar presence detection (zatím není vytvořený).

### Vytvoření systemd service

```bash
sudo nano /etc/systemd/system/ld2450.service
```

**Obsah:**
```ini
[Unit]
Description=LD2450 Radar Presence Detection Daemon
After=network.target mosquitto.service
Wants=mosquitto.service

[Service]
Type=simple
User=admin
WorkingDirectory=/home/admin/smartMirror/ld2450
ExecStart=/usr/bin/python3 /home/admin/smartMirror/ld2450/ld2450_daemon.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Aktivace:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable ld2450
sudo systemctl start ld2450

# Status
sudo systemctl status ld2450

# Logy
sudo journalctl -u ld2450 -f
```

---

## 4. GPIO Permissions (pro relay ovládání)

Přidání uživatele do gpio skupiny:

```bash
sudo usermod -a -G gpio admin

# Restart shellu nebo Pi aby se změna projevila
# Ověření:
groups
# Mělo by obsahovat: gpio
```

---

## 5. Camera Permissions

Přidání uživatele do video skupiny:

```bash
sudo usermod -a -G video admin

# Ověření:
groups
# Mělo by obsahovat: video

# Test kamery
cd ~/smartMirror/camera
python3 -c "from picamera2 import Picamera2; print('Camera OK')"
```

---

## 6. UART Configuration (pro LD2450 radar)

Již nakonfigurováno v `/boot/firmware/config.txt`:

```
enable_uart=1
dtoverlay=disable-bt
```

**Ověření UART:**
```bash
ls -l /dev/ttyAMA0
# Mělo by existovat: crw-rw---- 1 root dialout ... /dev/ttyAMA0

# Test čtení dat z radaru
cd ~/smartMirror/ld2450
python3 test_radar.py
```

---

## 7. Complete System Startup Order

Po restartu Pi se automaticky spustí:

1. **Mosquitto** (systemd) - MQTT broker
2. **MagicMirror** (PM2) - zobrazení na obrazovce
3. **ld2450 daemon** (systemd, až bude nakonfigurovaný) - radar presence detection

### Ověření všech služeb:

```bash
# MQTT broker
sudo systemctl status mosquitto

# MagicMirror
pm2 list

# Radar daemon (až bude aktivní)
sudo systemctl status ld2450

# Všechny systemd services najednou
systemctl list-units --type=service --state=running | grep -E 'mosquitto|ld2450'
```

---

## 8. Debugging Flow

### Sledování všeho najednou (multi-terminál setup)

**Terminál 1: MagicMirror logs**
```bash
pm2 logs MagicMirror --lines 100
```

**Terminál 2: MQTT zprávy**
```bash
mosquitto_sub -h 127.0.0.1 -t '#' -v
```

**Terminál 3: Radar daemon logs (až bude aktivní)**
```bash
sudo journalctl -u ld2450 -f
```

**Terminál 4: Test příkazy**
```bash
# Simulace událostí
mosquitto_pub -h 127.0.0.1 -t 'smartmirror/radar/presence' -m 'present'
cd ~/smartMirror/camera && python3 face_reco_once.py --preview
```

---

## 9. Updating from Git Repository

```bash
cd ~/smartMirror
git pull

# Pokud jsou změny v config souborech:
cp MagicMirror/config/config.js ~/MagicMirror/config/
cp MagicMirror/config/pages.js ~/MagicMirror/config/

# Pokud jsou změny v modulech:
cp -r MagicMirror/modules/MMM-Profile ~/MagicMirror/modules/
cd ~/MagicMirror/modules/MMM-Profile && npm install

# Pokud jsou změny v radaru nebo kameře:
# Soubory jsou přímo v ~/smartMirror/ld2450 a ~/smartMirror/camera

# Restart služeb
pm2 restart MagicMirror
sudo systemctl restart ld2450  # až bude aktivní
```

---

## 10. Complete Fresh Install (from backup)

Pokud bys musel obnovit vše z tohoto repozitáře:

```bash
# 1. Clone repository
cd ~
git clone https://github.com/Domes711/smartMirror.git

# 2. Install MagicMirror core
cd ~
git clone https://github.com/MagicMirrorOrg/MagicMirror
cd MagicMirror
npm install --only=prod --omit=dev

# 3. Copy configs
cp ~/smartMirror/MagicMirror/config/config.js ~/MagicMirror/config/
cp ~/smartMirror/MagicMirror/config/pages.js ~/MagicMirror/config/

# 4. Install custom modules
cp -r ~/smartMirror/MagicMirror/modules/MMM-* ~/MagicMirror/modules/
cd ~/MagicMirror/modules/MMM-Profile && npm install
cd ~/MagicMirror/modules/MMM-Brno-Transit && npm install
cd ~/MagicMirror/modules/MMM-HA-Reminders && npm install
cd ~/MagicMirror/modules/MMM-Spending && npm install

# 5. Install dependencies
sudo apt install -y mosquitto mosquitto-clients python3-serial \
    python3-paho-mqtt python3-picamera2 python3-opencv \
    python3-face-recognition

# 6. Setup PM2
sudo npm install -g pm2
cd ~/MagicMirror
pm2 start npm --name "MagicMirror" -- start
pm2 save
pm2 startup  # spustí příkaz který vypíše

# 7. Configure services (ld2450, mqtt)
# ... viz sekce výše
```

---

## Common Issues

### PM2 "command not found"
```bash
sudo npm install -g pm2
```

### MagicMirror černá obrazovka
```bash
# Zkontroluj DISPLAY proměnnou
echo $DISPLAY  # Mělo by být :0

# Restart
pm2 restart MagicMirror

# Zkontroluj logy
pm2 logs MagicMirror --lines 50
```

### MQTT connection refused
```bash
# Zkontroluj že Mosquitto běží
sudo systemctl status mosquitto

# Test lokální konektivty
mosquitto_pub -h 127.0.0.1 -t 'test' -m 'hello'
```

### Face recognition "No module named 'picamera2'"
```bash
sudo apt install python3-picamera2
```

### Radar "Permission denied: /dev/ttyAMA0"
```bash
sudo usermod -a -G dialout admin
# Logout/login nebo restart
```
