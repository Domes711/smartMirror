# LD2450 Presence Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate HLK-LD2450 radar sensor with Raspberry Pi to detect presence within 1.5m and control display power via GPIO17 relay (simulating button press) — display ON when someone approaches, OFF after 2 minutes without presence.

**Architecture:** A Python daemon reads LD2450 binary frames from UART `/dev/ttyAMA0` at 256000 baud, calculates target distances, tracks presence state, and pulses GPIO17 to trigger a relay on state changes. A systemd service ensures the daemon runs on boot.

**Tech Stack:** Python 3, pyserial, RPi.GPIO, systemd

**All commands run on Pi via SSH:** `ssh admin@10.0.0.249`

---

## File Structure

| File | Purpose |
|---|---|
| `~/ld2450/ld2450_daemon.py` | Main daemon — UART read, parse, presence logic, GPIO |
| `~/ld2450/test_ld2450.py` | Unit tests for frame parsing and presence logic |
| `/etc/systemd/system/ld2450.service` | systemd unit to run daemon on boot |

---

### Task 1: Install Python dependencies on Pi

**Files:**
- No files created — packages only

- [ ] **Step 1: SSH onto Pi**

```bash
ssh admin@10.0.0.249
```

- [ ] **Step 2: Install pyserial and RPi.GPIO**

```bash
pip3 install pyserial RPi.GPIO --break-system-packages
```

Expected output ends with:
```
Successfully installed pyserial-x.x RPi.GPIO-x.x.x
```

- [ ] **Step 3: Enable UART on Pi**

```bash
sudo raspi-config nonint do_serial_hw 0
sudo raspi-config nonint do_serial_cons 1
```

Then reboot:
```bash
sudo reboot
```

- [ ] **Step 4: Verify UART device exists after reboot**

```bash
ls /dev/ttyAMA0
```

Expected:
```
/dev/ttyAMA0
```

- [ ] **Step 5: Verify Python imports**

```bash
python3 -c "import serial; import RPi.GPIO; print('OK')"
```

Expected:
```
OK
```

---

### Task 2: Write frame parser with tests

**Files:**
- Create: `~/ld2450/test_ld2450.py`
- Create: `~/ld2450/ld2450_daemon.py` (parser only)

- [ ] **Step 1: Create project directory**

```bash
mkdir -p ~/ld2450
```

- [ ] **Step 2: Write failing tests for frame parser**

```bash
cat > ~/ld2450/test_ld2450.py << 'EOF'
import struct
import pytest
from ld2450_daemon import parse_frame, calculate_distance

def make_frame(targets):
    """Build a valid LD2450 frame with given targets (list of (x, y, speed))."""
    header = bytes([0xFD, 0xFC, 0xFB, 0xFA])
    footer = bytes([0x04, 0x03, 0x02, 0x01])
    data = b''
    for x, y, speed in targets:
        data += struct.pack('<hhH', x, y, speed)
    # pad to 3 targets
    while len(data) < 18:
        data += bytes(6)
    length = struct.pack('<H', len(data))
    return header + length + data + footer

def test_parse_valid_frame_single_target():
    frame = make_frame([(500, 1000, 0)])
    targets = parse_frame(frame)
    assert len(targets) == 1
    assert targets[0] == (500, 1000, 0)

def test_parse_valid_frame_no_target():
    frame = make_frame([(0, 0, 0)])
    targets = parse_frame(frame)
    assert targets[0] == (0, 0, 0)

def test_parse_invalid_header_returns_empty():
    bad_frame = bytes([0x00] * 26)
    targets = parse_frame(bad_frame)
    assert targets == []

def test_parse_frame_too_short_returns_empty():
    targets = parse_frame(bytes([0xFD, 0xFC]))
    assert targets == []

def test_calculate_distance():
    assert calculate_distance(0, 1000) == pytest.approx(1000.0)
    assert calculate_distance(500, 866) == pytest.approx(1000.0, abs=1.0)

def test_calculate_distance_zero():
    assert calculate_distance(0, 0) == 0.0

if __name__ == '__main__':
    pytest.main([__file__, '-v'])
EOF
echo 'Tests written'
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd ~/ld2450 && python3 -m pytest test_ld2450.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'ld2450_daemon'`

- [ ] **Step 4: Write minimal ld2450_daemon.py with parser only**

```bash
cat > ~/ld2450/ld2450_daemon.py << 'EOF'
import struct
import math
import serial
import RPi.GPIO as GPIO
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('ld2450')

FRAME_HEADER = bytes([0xFD, 0xFC, 0xFB, 0xFA])
FRAME_FOOTER = bytes([0x04, 0x03, 0x02, 0x01])
FRAME_MIN_LEN = 10  # header(4) + length(2) + data(0+) + footer(4)

GPIO_RELAY = 17
PRESENCE_DISTANCE_MM = 1500
ABSENCE_TIMEOUT_SEC = 120
RELAY_PULSE_MS = 100


def parse_frame(data: bytes) -> list:
    """Parse a LD2450 binary frame. Returns list of (x, y, speed) tuples or []."""
    if len(data) < FRAME_MIN_LEN:
        return []
    if data[:4] != FRAME_HEADER:
        return []
    if data[-4:] != FRAME_FOOTER:
        return []
    payload_len = struct.unpack_from('<H', data, 4)[0]
    payload = data[6:6 + payload_len]
    targets = []
    for i in range(0, min(len(payload), 18), 6):
        if i + 6 > len(payload):
            break
        x, y, speed = struct.unpack_from('<hhH', payload, i)
        targets.append((x, y, speed))
    return targets


def calculate_distance(x: int, y: int) -> float:
    """Calculate Euclidean distance in mm from radar origin."""
    return math.sqrt(x ** 2 + y ** 2)
EOF
echo 'Parser written'
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/ld2450 && python3 -m pytest test_ld2450.py -v 2>&1
```

Expected:
```
test_ld2450.py::test_parse_valid_frame_single_target PASSED
test_ld2450.py::test_parse_valid_frame_no_target PASSED
test_ld2450.py::test_parse_invalid_header_returns_empty PASSED
test_ld2450.py::test_parse_frame_too_short_returns_empty PASSED
test_ld2450.py::test_calculate_distance PASSED
test_ld2450.py::test_calculate_distance_zero PASSED
6 passed
```

- [ ] **Step 6: Commit**

```bash
cd ~/ld2450 && git init && git add . && git commit -m "feat: add LD2450 frame parser with tests"
```

---

### Task 3: Write presence logic with tests

**Files:**
- Modify: `~/ld2450/test_ld2450.py` (add presence tests)
- Modify: `~/ld2450/ld2450_daemon.py` (add PresenceTracker class)

- [ ] **Step 1: Add failing tests for PresenceTracker**

```bash
cat >> ~/ld2450/test_ld2450.py << 'EOF'

from ld2450_daemon import PresenceTracker

def test_presence_detected_when_target_within_range():
    tracker = PresenceTracker(distance_mm=1500, timeout_sec=120)
    targets = [(0, 1000, 0)]  # 1000mm away
    event = tracker.update(targets)
    assert event == 'PRESENT'

def test_no_event_when_already_present():
    tracker = PresenceTracker(distance_mm=1500, timeout_sec=120)
    tracker.update([(0, 1000, 0)])  # first: PRESENT
    event = tracker.update([(0, 1000, 0)])  # second: no change
    assert event is None

def test_no_event_when_target_too_far():
    tracker = PresenceTracker(distance_mm=1500, timeout_sec=120)
    event = tracker.update([(0, 2000, 0)])  # 2000mm > 1500mm
    assert event is None

def test_absent_event_after_timeout():
    tracker = PresenceTracker(distance_mm=1500, timeout_sec=0)
    tracker.update([(0, 1000, 0)])   # PRESENT
    tracker.update([(0, 2000, 0)])   # no target in range, timeout=0 → immediate ABSENT
    event = tracker.update([(0, 2000, 0)])
    assert event == 'ABSENT'

def test_no_absent_event_before_timeout():
    tracker = PresenceTracker(distance_mm=1500, timeout_sec=9999)
    tracker.update([(0, 1000, 0)])   # PRESENT
    event = tracker.update([(0, 2000, 0)])  # no target but timeout not elapsed
    assert event is None
EOF
echo 'Presence tests added'
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
cd ~/ld2450 && python3 -m pytest test_ld2450.py -v -k "presence" 2>&1 | head -20
```

Expected: `ImportError` or `FAILED` for presence tests.

- [ ] **Step 3: Add PresenceTracker to ld2450_daemon.py**

Add this class after the `calculate_distance` function (before the end of the file):

```bash
cat >> ~/ld2450/ld2450_daemon.py << 'EOF'


class PresenceTracker:
    def __init__(self, distance_mm: int, timeout_sec: int):
        self.distance_mm = distance_mm
        self.timeout_sec = timeout_sec
        self._present = False
        self._last_seen = None  # time when presence was last detected

    def update(self, targets: list):
        """
        Feed new targets. Returns 'PRESENT', 'ABSENT', or None.
        - 'PRESENT': someone just entered range
        - 'ABSENT': no one in range for timeout_sec seconds
        - None: no state change
        """
        in_range = any(
            calculate_distance(x, y) <= self.distance_mm
            for x, y, _ in targets
            if not (x == 0 and y == 0)
        )

        now = time.monotonic()

        if in_range:
            self._last_seen = now
            if not self._present:
                self._present = True
                return 'PRESENT'
            return None

        # Nothing in range
        if self._present:
            elapsed = (now - self._last_seen) if self._last_seen else self.timeout_sec
            if elapsed >= self.timeout_sec:
                self._present = False
                self._last_seen = None
                return 'ABSENT'
        return None
EOF
echo 'PresenceTracker added'
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
cd ~/ld2450 && python3 -m pytest test_ld2450.py -v 2>&1
```

Expected: `11 passed`

- [ ] **Step 5: Commit**

```bash
cd ~/ld2450 && git add . && git commit -m "feat: add PresenceTracker with timeout logic"
```

---

### Task 4: Write GPIO relay control and main loop

**Files:**
- Modify: `~/ld2450/ld2450_daemon.py` (add relay pulse + main loop)

- [ ] **Step 1: Append relay pulse function and main loop to ld2450_daemon.py**

```bash
cat >> ~/ld2450/ld2450_daemon.py << 'EOF'


def setup_gpio():
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(GPIO_RELAY, GPIO.OUT, initial=GPIO.LOW)
    log.info("GPIO17 ready")


def pulse_relay():
    """Pulse GPIO17 for RELAY_PULSE_MS milliseconds to simulate button press."""
    GPIO.output(GPIO_RELAY, GPIO.HIGH)
    time.sleep(RELAY_PULSE_MS / 1000)
    GPIO.output(GPIO_RELAY, GPIO.LOW)
    log.info("Relay pulsed")


def read_frame(ser: serial.Serial) -> bytes:
    """Read one complete LD2450 frame from serial port."""
    buf = b''
    while True:
        byte = ser.read(1)
        if not byte:
            continue
        buf += byte
        if len(buf) >= 4 and buf[-4:] == FRAME_FOOTER:
            if buf[:4] == FRAME_HEADER:
                return buf
            buf = b''  # bad frame, reset


def main():
    setup_gpio()
    tracker = PresenceTracker(
        distance_mm=PRESENCE_DISTANCE_MM,
        timeout_sec=ABSENCE_TIMEOUT_SEC
    )
    try:
        with serial.Serial('/dev/ttyAMA0', 256000, timeout=1) as ser:
            log.info("LD2450 daemon started, listening on /dev/ttyAMA0")
            while True:
                frame = read_frame(ser)
                targets = parse_frame(frame)
                event = tracker.update(targets)
                if event == 'PRESENT':
                    log.info("Presence detected — turning display ON")
                    pulse_relay()
                elif event == 'ABSENT':
                    log.info("Absence timeout — turning display OFF")
                    pulse_relay()
    except KeyboardInterrupt:
        log.info("Daemon stopped")
    finally:
        GPIO.cleanup()


if __name__ == '__main__':
    main()
EOF
echo 'Main loop added'
```

- [ ] **Step 2: Verify syntax**

```bash
python3 -c "import ld2450_daemon; print('Syntax OK')" 2>&1
```

Expected:
```
Syntax OK
```

- [ ] **Step 3: Run all tests to confirm nothing broken**

```bash
cd ~/ld2450 && python3 -m pytest test_ld2450.py -v 2>&1
```

Expected: `11 passed`

- [ ] **Step 4: Commit**

```bash
cd ~/ld2450 && git add . && git commit -m "feat: add GPIO relay pulse and main daemon loop"
```

---

### Task 5: Create systemd service

**Files:**
- Create: `/etc/systemd/system/ld2450.service`

- [ ] **Step 1: Create systemd unit file**

```bash
sudo bash -c 'cat > /etc/systemd/system/ld2450.service << EOF
[Unit]
Description=LD2450 Presence Detection Daemon
After=network.target

[Service]
ExecStart=/usr/bin/python3 /home/admin/ld2450/ld2450_daemon.py
WorkingDirectory=/home/admin/ld2450
Restart=always
RestartSec=5
User=admin
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF'
echo 'Service file created'
```

- [ ] **Step 2: Enable and start the service**

```bash
sudo systemctl daemon-reload
sudo systemctl enable ld2450
sudo systemctl start ld2450
```

- [ ] **Step 3: Verify service is running**

```bash
sudo systemctl status ld2450
```

Expected output contains:
```
Active: active (running)
```

- [ ] **Step 4: Check logs**

```bash
journalctl -u ld2450 -n 20
```

Expected output contains:
```
LD2450 daemon started, listening on /dev/ttyAMA0
```

- [ ] **Step 5: Commit**

```bash
cd ~/ld2450 && git add . && git commit -m "feat: add systemd service for LD2450 daemon"
```

---

### Task 6: End-to-end test

**Files:**
- No new files

- [ ] **Step 1: Wire up LD2450 to Pi** (physical)

| LD2450 | Raspberry Pi |
|---|---|
| VCC | Pin 2 (5V) |
| GND | Pin 6 (GND) |
| TX | Pin 10 (GPIO15 / RXD) |
| RX | Pin 8 (GPIO14 / TXD) |

Connect relay module to GPIO17 (Pin 11) and GND (Pin 9). Connect relay output in parallel with display power button.

- [ ] **Step 2: Watch live logs**

```bash
journalctl -u ld2450 -f
```

- [ ] **Step 3: Test presence detection**

Stand within 1.5m of the radar. Within 2 seconds you should see:
```
Presence detected — turning display ON
Relay pulsed
```
Display turns ON.

- [ ] **Step 4: Test absence timeout**

Move away (beyond 1.5m or leave the room). After 2 minutes you should see:
```
Absence timeout — turning display OFF
Relay pulsed
```
Display turns OFF.

- [ ] **Step 5: Test service auto-restart**

```bash
sudo systemctl restart ld2450
sudo systemctl status ld2450
```

Expected: service restarts cleanly and logs show daemon started again.

- [ ] **Step 6: Final commit and push**

```bash
cd ~/ld2450 && git add . && git commit -m "feat: LD2450 presence detection complete"
```
