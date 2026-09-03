# Display Control Daemon

MQTT-driven display control for the smart mirror. Listens to `smartmirror/display/control` and controls the monitor via:
- **Power toggle** (GPIO17 relay, simulates power button press)
- **Brightness** (DDC/CI via `ddcutil`)

## MQTT API

Topic: `smartmirror/display/control`

### Power toggle
```json
{"command": "toggle"}
```
Pulses GPIO17 to simulate a power button press (wake from standby or enter standby).

### Brightness
```json
{"command": "brightness", "value": 75}
```
Sets display brightness via DDC/CI (`value`: 0-100).

## Requirements

- `paho-mqtt` (Python) — already installed for camera/radar daemons
- `ddcutil` — for brightness control (optional, install with `sudo apt install ddcutil`)
- GPIO access (runs as `admin`, same as ld2450)

## Setup

```bash
# Install ddcutil (optional, for brightness control)
sudo apt install ddcutil

# Install systemd service
sudo cp systemd/display-control.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now display-control

# Check logs
journalctl -u display-control -f
```

## Testing

From mirror-console MQTT panel or via command line:

```bash
# Toggle power
mosquitto_pub -h 127.0.0.1 -t smartmirror/display/control -m '{"command":"toggle"}'

# Set brightness to 50%
mosquitto_pub -h 127.0.0.1 -t smartmirror/display/control -m '{"command":"brightness","value":50}'
```

## Notes

- **GPIO17** is shared with the ld2450 daemon for presence-based power control. This daemon provides manual override via MQTT.
- **DDC/CI** may not work on all displays. If `ddcutil` fails, brightness buttons will log warnings but won't crash.
- **No feedback** — the daemon doesn't publish current state (power on/off, brightness level). It's fire-and-forget.
