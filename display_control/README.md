# Display Control Daemon

Comprehensive MQTT-driven monitor control for Dell U2515H via DDC/CI (ddcutil).

## Features

- **Power Control**
  - DDC/CI on/standby (direct power management)
- **Picture Settings**
  - Brightness (0-100)
  - Contrast (0-100)
  - RGB gains (0-100 per channel)
- **Color & Display Modes**
  - Color presets: 5000K, 6500K, 7500K, 9300K, 10000K, User1, User2
  - Display modes: Standard, Movie, Games
- **Custom Features**
  - E2 feature (0-25, monitor-specific)
- **State Monitoring**
  - Publishes current settings to MQTT (retained)
  - On-demand state refresh

## MQTT API

All topics under `smartmirror/display/`:

### Control Topics (subscribe)

| Topic | Payload | Description |
|-------|---------|-------------|
| `control/power` | `on` / `standby` | DDC/CI power control |
| `control/brightness` | `0-100` | Set brightness |
| `control/contrast` | `0-100` | Set contrast |
| `control/rgb` | `{"r":0-100,"g":0-100,"b":0-100}` | Set RGB gains |
| `control/preset` | `5000K` / `6500K` / `7500K` / `9300K` / `10000K` / `user1` / `user2` | Color temperature |
| `control/mode` | `standard` / `movie` / `games` | Display mode |
| `control/e2` | `0-25` | Custom feature E2 |
| `control/get_state` | (any) | Trigger immediate state publish |

### State Topic (publish)

| Topic | Format | Description |
|-------|--------|-------------|
| `smartmirror/display/state` | JSON | Current monitor state (retained) |

**State example:**
```json
{
  "brightness": 100,
  "contrast": 75,
  "red": 100,
  "green": 100,
  "blue": 100,
  "power": 1,
  "timestamp": 1234567890.123
}
```

## Setup

```bash
cd ~/smartMirror/display_control
./setup.sh
```

Installs:
- `display-control` systemd service (enabled, auto-start on boot)
- All Python dependencies (`paho-mqtt` from camera/radar setup)

## Requirements

- **`paho-mqtt`** (Python) — already installed via camera/radar setup
- **`ddcutil`** — for DDC/CI control (`sudo apt install ddcutil`)
- **MQTT broker** (mosquitto) running on `127.0.0.1:1883`

## Usage Examples

```bash
# DDC/CI power on
mosquitto_pub -t smartmirror/display/control/power -m "on"

# DDC/CI standby
mosquitto_pub -t smartmirror/display/control/power -m "standby"

# Set brightness to 75%
mosquitto_pub -t smartmirror/display/control/brightness -m "75"

# Set contrast to 50%
mosquitto_pub -t smartmirror/display/control/contrast -m "50"

# Set RGB gains
mosquitto_pub -t smartmirror/display/control/rgb -m '{"r":100,"g":95,"b":90}'

# Set color temperature to 6500K
mosquitto_pub -t smartmirror/display/control/preset -m "6500k"

# Set Games mode
mosquitto_pub -t smartmirror/display/control/mode -m "games"

# Set E2 feature
mosquitto_pub -t smartmirror/display/control/e2 -m "15"

# Request current state
mosquitto_pub -t smartmirror/display/control/get_state -m "1"

# Subscribe to state changes
mosquitto_sub -t smartmirror/display/state
```

## Service Management

```bash
# Status
sudo systemctl status display-control

# Restart
sudo systemctl restart display-control

# Logs
journalctl -u display-control -f

# Stop
sudo systemctl stop display-control

# Start
sudo systemctl start display-control
```

## Notes

- **DDC/CI** may not work on all displays. The daemon will log warnings but won't crash if `ddcutil` fails.
- **State publishing** happens after every control command (with 500ms delay for monitor to update) and on-demand via `get_state`.
- **Auto-init**: On startup and after power-on, the daemon sets the monitor to Standard mode to disable dynamic contrast (which blocks manual brightness control on Dell monitors).
- **VCP codes** follow the VESA DDC/CI standard and may vary by monitor model.

## Troubleshooting

If monitor control doesn't work:

1. **Check ddcutil works manually:**
   ```bash
   ddcutil detect
   ddcutil getvcp 10  # brightness
   ddcutil setvcp 10 50  # set brightness to 50
   ```

2. **Check user is in i2c group** (required for DDC/CI):
   ```bash
   groups admin
   sudo usermod -a -G i2c admin
   # Then logout and login again
   ```

3. **Check MQTT broker is running:**
   ```bash
   sudo systemctl status mosquitto
   ```

4. **Check service logs:**
   ```bash
   journalctl -u display-control -f
   ```

5. **Test MQTT connectivity:**
   ```bash
   mosquitto_pub -t test -m "hello"
   mosquitto_sub -t test -C 1
   ```
