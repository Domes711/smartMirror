# Monitor Control

MQTT-controlled monitor settings daemon for Dell U2515H via DDC/CI.

## Features

- Real-time monitor control via MQTT
- Brightness, contrast, color temperature, RGB gain
- Power on/off/standby
- Display modes (Standard, Movie, Games)
- Custom feature E2 (brightness enhancement)
- Publishes current monitor state

## Installation

```bash
cd ~/smartMirror/monitor-control
./setup.sh
```

## MQTT Topics

### Control (subscribe)

| Topic | Values | Description |
|-------|--------|-------------|
| `smartmirror/monitor/control/brightness` | 0-100 | Set brightness |
| `smartmirror/monitor/control/contrast` | 0-100 | Set contrast |
| `smartmirror/monitor/control/power` | on/off/standby | Power control |
| `smartmirror/monitor/control/mode` | standard/movie/games | Display mode |
| `smartmirror/monitor/control/preset` | 5000K/6500K/7500K/9300K/10000K/user1/user2 | Color temperature |
| `smartmirror/monitor/control/rgb` | `{"r":100,"g":100,"b":100}` | RGB gain |
| `smartmirror/monitor/control/e2` | 0-25 | Custom brightness enhancement |
| `smartmirror/monitor/control/refresh` | any | Trigger state publish |

### State (publish)

| Topic | Format | Description |
|-------|--------|-------------|
| `smartmirror/monitor/state` | JSON | Current monitor state (retained) |

Example state:
```json
{
  "brightness": 100,
  "contrast": 100,
  "red": 100,
  "green": 100,
  "blue": 100,
  "timestamp": 1234567890.123
}
```

## Usage Examples

```bash
# Set brightness to 50%
mosquitto_pub -t smartmirror/monitor/control/brightness -m 50

# Set contrast to 75%
mosquitto_pub -t smartmirror/monitor/control/contrast -m 75

# Turn off monitor
mosquitto_pub -t smartmirror/monitor/control/power -m off

# Turn on monitor
mosquitto_pub -t smartmirror/monitor/control/power -m on

# Set Games mode
mosquitto_pub -t smartmirror/monitor/control/mode -m games

# Set 6500K color temperature
mosquitto_pub -t smartmirror/monitor/control/preset -m 6500K

# Set RGB gains
mosquitto_pub -t smartmirror/monitor/control/rgb -m '{"r":100,"g":100,"b":100}'

# Set custom E2 feature (brightness enhancement)
mosquitto_pub -t smartmirror/monitor/control/e2 -m 25

# Get current state
mosquitto_sub -t smartmirror/monitor/state -C 1
```

## Service Management

```bash
# Start
sudo systemctl start monitor-control

# Stop
sudo systemctl stop monitor-control

# Restart
sudo systemctl restart monitor-control

# Status
sudo systemctl status monitor-control

# Logs
journalctl -u monitor-control -f
```

## Requirements

- `ddcutil` installed and configured
- `paho-mqtt` Python package
- User in `i2c` group
- MQTT broker (mosquitto) running

## Troubleshooting

If monitor control doesn't work:

1. Check ddcutil works manually:
   ```bash
   ddcutil detect
   ddcutil getvcp 10
   ```

2. Check user is in i2c group:
   ```bash
   groups admin
   ```

3. Check MQTT broker is running:
   ```bash
   sudo systemctl status mosquitto
   ```

4. Check service logs:
   ```bash
   journalctl -u monitor-control -f
   ```
