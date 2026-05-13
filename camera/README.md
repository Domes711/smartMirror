# Camera Scripts

Python scripts for camera-based recognition on the smart mirror:
- **Face recognition** - identifies users via trained face encodings
- **Gesture recognition** - detects hand gestures (finger counting)

Both scripts use **MQTT** to publish events to the mirror.

## Architecture

All scripts run **on-demand** (not as daemons) and publish results to MQTT:

```
Trigger → Python script → RPi Camera → Recognition → MQTT publish → MMM modules
```

- **MQTT broker**: `127.0.0.1:1883` (local mosquitto)
- **Face topic**: `smartmirror/camera/recognition`
- **Gesture topic**: `smartmirror/camera/gesture`

## Installation

### 1. Install system dependencies

```bash
# Picamera2 (usually pre-installed on Raspberry Pi OS)
sudo apt install -y python3-picamera2

# MQTT broker
sudo apt install -y mosquitto mosquitto-clients
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

### 2. Install Python dependencies

```bash
cd ~/smartMirror/camera
pip3 install -r requirements.txt
```

### 3. Train face recognition (first time only)

```bash
# 1. Capture training photos
python3 capture_photos.py

# 2. Encode faces into pickle file
python3 encode_faces.py
```

This creates `encoded_faces.pickle` used by `face_reco_once.py`.

## Usage

### Face Recognition

Scans camera stream for up to 10 seconds, returns first recognized face:

```bash
# Production (called by ld2450_daemon)
python3 face_reco_once.py

# Testing with preview window
python3 face_reco_once.py --preview

# Custom timeout
python3 face_reco_once.py --max-duration 5

# Custom encodings file
python3 face_reco_once.py --encodings /path/to/encoded_faces.pickle
```

**MQTT output:**
```json
{"user": "Domes"}           # recognized
{"user": null}              # timeout or unknown face
```

### Gesture Recognition

Scans camera stream for hand gestures (finger counting 0-5):

```bash
# Production
python3 gesture_reco_once.py

# Testing with preview window
python3 gesture_reco_once.py --preview

# Custom timeout
python3 gesture_reco_once.py --max-duration 5

# Adjust detection confidence (0.0-1.0)
python3 gesture_reco_once.py --confidence 0.7
```

**MQTT output:**
```json
{"gesture": "finger_count", "count": 3, "elapsed": 2.1}  # detected 3 fingers
{"gesture": null}                                          # no hand detected
```

## Testing MQTT locally

Subscribe to all camera events:

```bash
# Terminal 1: Subscribe to face recognition
mosquitto_sub -h 127.0.0.1 -t "smartmirror/camera/recognition"

# Terminal 2: Subscribe to gesture recognition
mosquitto_sub -h 127.0.0.1 -t "smartmirror/camera/gesture"

# Terminal 3: Run a recognition script
python3 gesture_reco_once.py --preview
```

## Integration with Mirror

### Face Recognition

Currently triggered by `ld2450_daemon.py` when presence is detected.
See `ld2450/ld2450_daemon.py` and `MagicMirror/modules/MMM-Profile/node_helper.js`.

### Gesture Recognition

Can be triggered:
1. **Manually** for testing: `python3 gesture_reco_once.py`
2. **From MMM module** via `child_process.spawn()` in `node_helper.js`
3. **On schedule** via cron or systemd timer

Example node_helper.js integration:

```javascript
const { spawn } = require('child_process');

function triggerGestureRecognition() {
  const process = spawn('python3', [
    '/home/admin/smartMirror/camera/gesture_reco_once.py',
    '--max-duration', '5'
  ]);

  process.on('exit', (code) => {
    console.log(`Gesture recognition exited with code ${code}`);
  });
}
```

The module would subscribe to MQTT topic `smartmirror/camera/gesture` to receive results.

## File Structure

```
camera/
├── face_reco_once.py         # on-demand face recognition
├── gesture_reco_once.py       # on-demand gesture recognition
├── encode_faces.py            # train face encodings
├── capture_photos.py          # capture training photos
├── encoded_faces.pickle       # trained face data
├── dataset/                   # training photos (Domes/, etc.)
├── requirements.txt           # Python dependencies
└── README.md                  # this file
```

## Troubleshooting

### Camera permission errors

```bash
# Add user to video group
sudo usermod -a -G video $USER
# Log out and back in
```

### MQTT connection failed

```bash
# Check mosquitto is running
sudo systemctl status mosquitto

# Test MQTT manually
mosquitto_pub -h 127.0.0.1 -t "test" -m "hello"
mosquitto_sub -h 127.0.0.1 -t "test"
```

### MediaPipe/OpenCV errors on Pi

```bash
# Make sure you have enough swap space
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile  # Set CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### Preview window doesn't show (SSH)

Preview mode requires X11 forwarding or running directly on the Pi with display:

```bash
# SSH with X11 forwarding
ssh -X admin@10.0.0.249
python3 gesture_reco_once.py --preview

# Or run directly on Pi (if monitor connected)
DISPLAY=:0 python3 gesture_reco_once.py --preview
```

## Conventions

- All scripts publish to MQTT, never POST directly to Express (old pattern)
- Failures always publish `{"user": null}` or `{"gesture": null}` so mirror never hangs
- Use `--preview` for testing, never in production (performance impact)
- Scripts return exit code 0 even on recognition failure (by design - not an error)
