import struct
import math
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('ld2450')

FRAME_HEADER = bytes([0xFD, 0xFC, 0xFB, 0xFA])
FRAME_FOOTER = bytes([0x04, 0x03, 0x02, 0x01])
FRAME_MIN_LEN = 10  # header(4) + length(2) + data(0+) + footer(4)

GPIO_RELAY = 17
PRESENCE_X_MM = 400     # half-width of detection zone (+-40cm)
PRESENCE_Y_MM = 1500    # depth of detection zone (1.5m)
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


class PresenceTracker:
    def __init__(self, x_mm: int, y_mm: int, timeout_sec: int):
        self.x_mm = x_mm      # half-width of detection zone (+-x_mm)
        self.y_mm = y_mm      # depth of detection zone (0 to y_mm)
        self.timeout_sec = timeout_sec
        self._present = False
        self._last_seen = None  # time when presence was last detected

    def update(self, targets: list):
        """
        Feed new targets. Returns 'PRESENT', 'ABSENT', or None.
        - 'PRESENT': someone just entered the rectangular zone
        - 'ABSENT': no one in zone for timeout_sec seconds
        - None: no state change
        """
        in_range = any(
            abs(x) <= self.x_mm and 0 < y <= self.y_mm
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
