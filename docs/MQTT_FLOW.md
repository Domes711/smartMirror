# MQTT Event Flow for Smart Mirror

## Architecture Overview

Two independent daemons communicate via MQTT with MMM-Profile module:

```
┌──────────────────┐         MQTT          ┌──────────────────┐
│  LD2450 Radar    │ ──────────────────────>│                  │
│     Daemon       │                        │                  │
│                  │   smartmirror/radar/   │   MMM-Profile    │
│  - Detects       │        presence        │                  │
│    presence      │   "present"|"absent"   │  - State machine │
│  - Controls GPIO │                        │  - Page layout   │
│  - Pulses relay  │                        │  - Indicator UI  │
└──────────────────┘                        │                  │
         │                                  │                  │
         │ triggers via MQTT                │                  │
         │                                  │                  │
         v                                  │                  │
┌──────────────────┐                        │                  │
│  Face Recognition│ ──────────────────────>│                  │
│     Daemon       │                        │                  │
│                  │  smartmirror/camera/   │                  │
│  - Listens for   │     recognition        │                  │
│    presence      │  {"user": "Domes"}     │                  │
│  - Scans camera  │  {"user": null}        │                  │
│  - Publishes ID  │                        │                  │
└──────────────────┘                        └──────────────────┘
```

## Event Flow

1. **Radar detects presence**
   - LD2450 daemon reads UART frames
   - Target enters detection zone
   - Publishes: `smartmirror/radar/presence = "present"`
   - Pulses GPIO17 to turn display ON

2. **Face recognition triggered**
   - Face daemon receives `presence = "present"` event
   - Starts camera scan (max 10 seconds)
   - Looks for trained faces in frames

3. **Recognition result published**
   - If known face found: `smartmirror/camera/recognition = {"user": "Domes"}`
   - If unknown/no face: `smartmirror/camera/recognition = {"user": null}`

4. **MMM-Profile updates**
   - Receives both MQTT events
   - Updates state machine
   - Shows correct page layout for user + time window
   - Displays indicator (Face ID animation → avatar)

5. **Radar detects absence**
   - No target for 60 seconds
   - Publishes: `smartmirror/radar/presence = "absent"`
   - Pulses GPIO17 to turn display OFF
   - After 60s timeout → MMM-Profile goes to sleep

## MQTT Topics

| Topic | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `smartmirror/radar/presence` | LD2450 → MMM-Profile | `"present"` \| `"absent"` | Presence detection state |
| `smartmirror/radar/presence` | LD2450 → Face Daemon | `"present"` | Triggers face scan |
| `smartmirror/camera/recognition` | Face Daemon → MMM-Profile | `{"user": "Domes"}` \| `{"user": null}` | Recognition result |
| `smartmirror/control/reset` | Manual/Script → All | any | Reset to initial state (asleep, no user) |

## Daemons

### 1. LD2450 Radar Daemon

**File:** `ld2450/ld2450_daemon.py`
**Service:** `ld2450.service`

- Reads LD2450 UART frames (@256000 baud)
- Filters targets to rectangular zone (±400mm x, 0-1500mm y)
- Tracks PRESENT/ABSENT with 60s timeout
- Controls GPIO17 relay for display power
- Publishes presence events to MQTT

**No longer spawns face_reco_once.py** - communication is purely via MQTT.

### 2. Face Recognition Daemon

**File:** `camera/face_reco_daemon.py`
**Service:** `camera/face_reco.service`

- Subscribes to `smartmirror/radar/presence`
- On `"present"` event → starts camera scan
- Uses `picamera2` + `face_recognition` library
- Scans multiple frames over 10 seconds for reliability
- Returns first recognized face or timeout
- Publishes result to MQTT
- Daemon stays idle until next presence event

**Event-driven, not continuous** - only scans when triggered by radar.

### 3. MMM-Profile Module

**File:** `MagicMirror/modules/MMM-Profile/`

- Subscribes to both MQTT topics
- Runs state machine (asleep → scanning → user → dimming)
- Resolves page layout based on (user, time-of-day)
- Renders Face ID indicator UI
- Controls visibility/position of all other modules

## Installation on Pi

### 1. Install both services

```bash
# Copy service files
sudo cp ~/smartMirror/ld2450/ld2450.service /etc/systemd/system/
sudo cp ~/smartMirror/camera/face_reco.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable ld2450.service
sudo systemctl enable face_reco.service

# Start both daemons
sudo systemctl start ld2450.service
sudo systemctl start face_reco.service
```

### 2. Check status

```bash
# View status
sudo systemctl status ld2450.service
sudo systemctl status face_reco.service

# Follow logs
sudo journalctl -u ld2450.service -f
sudo journalctl -u face_reco.service -f

# View combined logs
sudo journalctl -u ld2450.service -u face_reco.service -f
```

### 3. Test MQTT flow

```bash
# Subscribe to all smartmirror topics
mosquitto_sub -h 127.0.0.1 -t "smartmirror/#" -v

# Manually trigger presence (in another terminal)
mosquitto_pub -h 127.0.0.1 -t "smartmirror/radar/presence" -m "present"

# You should see:
# 1. Face daemon starts scanning
# 2. Recognition result published
# 3. MMM-Profile receives both events

# Reset to initial state (useful for testing)
mosquitto_pub -h 127.0.0.1 -t "smartmirror/control/reset" -m "init"
```

## Dependencies

### Python packages (install with pip)
```bash
pip3 install paho-mqtt face_recognition picamera2
```

### System packages
```bash
sudo apt-get install mosquitto mosquitto-clients
```

## Troubleshooting

### Face daemon not triggering
```bash
# Check MQTT broker is running
sudo systemctl status mosquitto

# Check face daemon is subscribed
sudo journalctl -u face_reco.service | grep "Subscribed"

# Manually publish test event
mosquitto_pub -h 127.0.0.1 -t "smartmirror/radar/presence" -m "present"
```

### Camera errors
```bash
# Check camera is enabled
vcgencmd get_camera

# Check no other process is using camera
sudo lsof | grep /dev/video

# Restart face daemon
sudo systemctl restart face_reco.service
```

### Radar not detecting
```bash
# Check UART is configured
ls -l /dev/ttyAMA0

# Check radar daemon is reading frames
sudo journalctl -u ld2450.service | grep "daemon started"

# Test radar directly
sudo python3 ~/smartMirror/ld2450/ld2450_test.py
```

## Configuration

### Change scan duration
Edit `face_reco.service`:
```ini
ExecStart=/usr/bin/python3 /home/admin/smartMirror/camera/face_reco_daemon.py --max-duration 5
```

### Change detection zone
Edit `ld2450_daemon.py`:
```python
PRESENCE_X_MM = 400      # ±400mm (wider/narrower)
PRESENCE_Y_MM = 1500     # 1500mm depth (closer/farther)
ABSENCE_TIMEOUT_SEC = 60 # 60s timeout (faster/slower)
```

### Change MQTT broker
Edit both `.service` files:
```ini
Environment="MQTT_BROKER=192.168.1.100"
Environment="MQTT_PORT=1883"
```

## Reset Command

The `smartmirror/control/reset` topic provides a way to reset the entire system to its initial state. This is useful for:
- Testing and development
- Recovering from stuck states
- Manual override

### Usage

```bash
# Reset everything to initial state
mosquitto_pub -h 127.0.0.1 -t "smartmirror/control/reset" -m "init"
```

### What it does

1. **Face recognition daemon:**
   - Publishes `{"user": null}` to clear current user
   - Stops waiting for presence (returns to idle)

2. **MMM-Profile:**
   - Cancels any dim timers
   - Sets state to `"asleep"`
   - Clears current user
   - Hides all modules (empty layout)
   - Updates frontend immediately

3. **Radar daemon:**
   - Not affected (continues monitoring independently)
   - Next presence event will trigger normal flow

### Example Testing Workflow

```bash
# Terminal 1: Watch all events
mosquitto_sub -h 127.0.0.1 -t "smartmirror/#" -v

# Terminal 2: Simulate full cycle
mosquitto_pub -h 127.0.0.1 -t "smartmirror/control/reset" -m "init"
sleep 2
mosquitto_pub -h 127.0.0.1 -t "smartmirror/radar/presence" -m "present"
# Wait for face recognition...
sleep 15
mosquitto_pub -h 127.0.0.1 -t "smartmirror/radar/presence" -m "absent"
sleep 5
mosquitto_pub -h 127.0.0.1 -t "smartmirror/control/reset" -m "init"
```

## Benefits of This Architecture

✅ **Independent daemons** - Radar and face recognition run separately
✅ **Event-driven** - Face scan only when needed (low CPU usage)
✅ **Reliable** - Multi-frame scanning handles bad angles/lighting
✅ **Debuggable** - Each component logs independently
✅ **Testable** - Can mock MQTT events for development
✅ **Resilient** - If one daemon crashes, others continue
✅ **Resettable** - Manual reset command for testing and recovery
