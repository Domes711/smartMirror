# Installing Smart Mirror Daemons

## Quick Setup (from ~/smartMirror directory)

All scripts live in the git repo at `~/smartMirror/`. Service files reference them directly - no copying needed.

### 1. Clone/pull latest code on Pi

```bash
cd ~/smartMirror
git pull origin master  # or your branch
```

### 2. Make scripts executable

```bash
chmod +x ~/smartMirror/ld2450/ld2450_daemon.py
chmod +x ~/smartMirror/camera/face_reco_daemon.py
```

### 3. Install systemd services

```bash
# Create symlinks instead of copying - services always use latest code
sudo ln -sf ~/smartMirror/ld2450/ld2450.service /etc/systemd/system/
sudo ln -sf ~/smartMirror/camera/face_reco.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable ld2450.service
sudo systemctl enable face_reco.service

# Start both daemons
sudo systemctl start ld2450.service
sudo systemctl start face_reco.service
```

### 4. Check status

```bash
sudo systemctl status ld2450.service
sudo systemctl status face_reco.service
```

### 5. View logs

```bash
# Combined logs from both services
sudo journalctl -u ld2450.service -u face_reco.service -f

# Just radar
sudo journalctl -u ld2450.service -f

# Just face recognition
sudo journalctl -u face_reco.service -f
```

## Updating Code

When you update code in the repo:

```bash
cd ~/smartMirror
git pull

# Restart services to load new code
sudo systemctl restart ld2450.service
sudo systemctl restart face_reco.service
```

No need to reinstall services - they reference the repo directly!

## Removing Services

```bash
sudo systemctl stop ld2450.service face_reco.service
sudo systemctl disable ld2450.service face_reco.service
sudo rm /etc/systemd/system/ld2450.service
sudo rm /etc/systemd/system/face_reco.service
sudo systemctl daemon-reload
```

## Testing MQTT Flow

```bash
# Terminal 1: Watch all MQTT messages
mosquitto_sub -h 127.0.0.1 -t "smartmirror/#" -v

# Terminal 2: Manually trigger presence
mosquitto_pub -h 127.0.0.1 -t "smartmirror/radar/presence" -m "present"

# You should see:
# - smartmirror/radar/presence present
# - Face daemon logs "Presence detected, starting face recognition"
# - smartmirror/camera/recognition {"user": "Domes"} (or null)
```

## Troubleshooting

### Service fails to start

```bash
# Check for errors
sudo journalctl -u ld2450.service -n 50
sudo journalctl -u face_reco.service -n 50

# Check file paths exist
ls -la ~/smartMirror/ld2450/ld2450_daemon.py
ls -la ~/smartMirror/camera/face_reco_daemon.py

# Check file permissions
stat ~/smartMirror/ld2450/ld2450_daemon.py
stat ~/smartMirror/camera/face_reco_daemon.py
```

### Python dependencies missing

```bash
pip3 install paho-mqtt face_recognition picamera2 pyserial RPi.GPIO
```

### MQTT broker not running

```bash
sudo systemctl status mosquitto
sudo systemctl start mosquitto
sudo systemctl enable mosquitto
```

### Camera permission errors

Make sure the `admin` user is in the `video` group:

```bash
sudo usermod -a -G video admin
# Log out and back in for group change to take effect
```

### Serial port permission errors

Make sure the `admin` user is in the `dialout` group:

```bash
sudo usermod -a -G dialout admin
# Log out and back in for group change to take effect
```
