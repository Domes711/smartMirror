"""LD2450 radar viewer.

Tkinter desktop app inspired by HLKRadarTool. Shows live targets on a
2D plot with the sensor at top-center, grid in mm, and the detection
zone PresenceTracker uses overlaid as a green rectangle.

Usage on the Pi:
    sudo systemctl stop ld2450      # release the serial port if running
    python3 viewer.py               # read /dev/ttyAMA0
    python3 viewer.py --simulate    # no hardware, animated fake target

Keys:
    q       quit
    f       toggle fullscreen
    space   pause / resume
    c       clear target trails
"""

import argparse
import math
import time
import tkinter as tk
from collections import deque
from dataclasses import dataclass

from ld2450_daemon import (
    FRAME_FOOTER,
    FRAME_HEADER,
    PRESENCE_X_MM,
    PRESENCE_Y_MM,
    ABSENCE_TIMEOUT_SEC,
    PresenceTracker,
    parse_frame,
)


# Plot coordinate system (mm). Sensor at (0, 0), Y points away from sensor.
PLOT_X_RANGE_MM = 2500   # show +/- 2500 mm on X
PLOT_Y_RANGE_MM = 4000   # show 0..4000 mm on Y
GRID_STEP_MM = 500
ARC_STEPS_MM = (1000, 2000, 3000, 4000)
TRAIL_LEN = 30           # how many past positions per target slot
TRAIL_FADE_MIN = 30      # min alpha (out of 255) for the oldest trail point


@dataclass
class Target:
    x: int
    y: int
    speed: int

    def is_zero(self) -> bool:
        return self.x == 0 and self.y == 0


class SimulatorSource:
    """Generates a single target walking back and forth across the zone."""

    def __init__(self):
        self._t = 0.0

    def read_targets(self) -> list:
        self._t += 0.05
        # Person walks in an oval inside the room
        x = int(800 * math.sin(self._t * 0.7))
        y = int(1200 + 700 * math.sin(self._t * 0.4))
        speed = int(50 * math.cos(self._t * 0.7))
        return [
            Target(x=x, y=y, speed=speed),
            Target(x=0, y=0, speed=0),
            Target(x=0, y=0, speed=0),
        ]

    def close(self):
        pass


class SerialSource:
    """Reads LD2450 frames from a serial port."""

    def __init__(self, port: str = '/dev/ttyAMA0', baud: int = 256000):
        import serial  # lazy: only required when actually using hardware
        self._ser = serial.Serial(port, baud, timeout=0.1)
        self._buf = b''

    def read_targets(self) -> list:
        # Try to read whatever is available without blocking the UI thread.
        chunk = self._ser.read(64)
        if chunk:
            self._buf += chunk
        # Look for the most recent complete frame in the buffer.
        last_targets = None
        while True:
            footer_at = self._buf.find(FRAME_FOOTER)
            if footer_at < 0:
                break
            frame_end = footer_at + len(FRAME_FOOTER)
            header_at = self._buf.rfind(FRAME_HEADER, 0, footer_at)
            if header_at < 0:
                # No matching header before this footer -- discard junk.
                self._buf = self._buf[frame_end:]
                continue
            frame = self._buf[header_at:frame_end]
            self._buf = self._buf[frame_end:]
            tuples = parse_frame(frame)
            if tuples:
                last_targets = [Target(x, y, s) for x, y, s in tuples]
        return last_targets or []

    def close(self):
        self._ser.close()


class RadarViewer:
    SLOT_COLORS = ('#ff4d4d', '#4dd0ff', '#a0ff4d')

    def __init__(self, root: tk.Tk, source, refresh_ms: int = 50):
        self.root = root
        self.source = source
        self.refresh_ms = refresh_ms
        self.paused = False
        self.fullscreen = False
        self.trails = [deque(maxlen=TRAIL_LEN) for _ in range(3)]
        self.tracker = PresenceTracker(
            x_mm=PRESENCE_X_MM,
            y_mm=PRESENCE_Y_MM,
            timeout_sec=ABSENCE_TIMEOUT_SEC,
        )
        self.last_event = None
        self.last_event_at = time.monotonic()

        root.title('LD2450 viewer')
        root.configure(bg='#000')
        root.bind('<Key-q>', lambda _e: self.quit())
        root.bind('<Key-f>', lambda _e: self.toggle_fullscreen())
        root.bind('<space>', lambda _e: self.toggle_pause())
        root.bind('<Key-c>', lambda _e: self.clear_trails())

        self.canvas = tk.Canvas(root, bg='#0a0a0a', highlightthickness=0)
        self.canvas.pack(fill=tk.BOTH, expand=True)

        self.status = tk.Label(
            root, text='', bg='#000', fg='#fff',
            font=('Consolas', 12), anchor='w', padx=10, pady=6,
        )
        self.status.pack(fill=tk.X, side=tk.BOTTOM)

        root.geometry('820x900')
        root.after(self.refresh_ms, self._tick)

    # --- coordinate transform ------------------------------------------------

    def _world_to_canvas(self, x_mm: int, y_mm: int):
        w = self.canvas.winfo_width() or 1
        h = self.canvas.winfo_height() or 1
        cx = w / 2 + (x_mm / PLOT_X_RANGE_MM) * (w / 2)
        cy = (y_mm / PLOT_Y_RANGE_MM) * h
        return cx, cy

    # --- drawing -------------------------------------------------------------

    def _draw_grid(self):
        w = self.canvas.winfo_width()
        h = self.canvas.winfo_height()

        # Vertical lines + X labels
        x_mm = -PLOT_X_RANGE_MM
        while x_mm <= PLOT_X_RANGE_MM:
            cx, _ = self._world_to_canvas(x_mm, 0)
            color = '#333' if x_mm != 0 else '#666'
            self.canvas.create_line(cx, 0, cx, h, fill=color)
            if x_mm != 0:
                self.canvas.create_text(
                    cx, h - 18, text=f'{x_mm}', fill='#666',
                    font=('Consolas', 9),
                )
            x_mm += GRID_STEP_MM

        # Horizontal lines + Y labels
        y_mm = 0
        while y_mm <= PLOT_Y_RANGE_MM:
            _, cy = self._world_to_canvas(0, y_mm)
            self.canvas.create_line(0, cy, w, cy, fill='#222')
            if y_mm > 0:
                self.canvas.create_text(
                    20, cy - 8, text=f'{y_mm} mm', fill='#666',
                    font=('Consolas', 9), anchor='w',
                )
            y_mm += GRID_STEP_MM

        # Range arcs
        cx0, cy0 = self._world_to_canvas(0, 0)
        for r_mm in ARC_STEPS_MM:
            rx, _ = self._world_to_canvas(r_mm, 0)
            _, ry = self._world_to_canvas(0, r_mm)
            radius_x = rx - cx0
            radius_y = ry - cy0
            self.canvas.create_oval(
                cx0 - radius_x, cy0 - radius_y,
                cx0 + radius_x, cy0 + radius_y,
                outline='#1d3a1d', dash=(2, 4),
            )

    def _draw_zone(self):
        x1, y1 = self._world_to_canvas(-PRESENCE_X_MM, 0)
        x2, y2 = self._world_to_canvas(PRESENCE_X_MM, PRESENCE_Y_MM)
        self.canvas.create_rectangle(
            x1, y1, x2, y2,
            outline='#3aff3a', dash=(4, 3), width=2,
        )
        self.canvas.create_text(
            (x1 + x2) / 2, y1 + 14,
            text=f'detection zone +/- {PRESENCE_X_MM} mm x {PRESENCE_Y_MM} mm',
            fill='#3aff3a', font=('Consolas', 10),
        )

    def _draw_sensor(self):
        cx, cy = self._world_to_canvas(0, 0)
        self.canvas.create_oval(cx - 6, cy - 6, cx + 6, cy + 6,
                                fill='#fff', outline='')
        self.canvas.create_text(cx, cy - 16, text='LD2450', fill='#fff',
                                font=('Consolas', 10, 'bold'))

    def _draw_trails(self):
        for slot, trail in enumerate(self.trails):
            color = self.SLOT_COLORS[slot]
            n = len(trail)
            for i, (x_mm, y_mm) in enumerate(trail):
                age = (n - i) / max(n, 1)
                size = 2 + (1 - age) * 3
                cx, cy = self._world_to_canvas(x_mm, y_mm)
                self.canvas.create_oval(
                    cx - size, cy - size, cx + size, cy + size,
                    fill=color, outline='', stipple='gray25' if age > 0.5 else '',
                )

    def _draw_targets(self, targets):
        for slot, t in enumerate(targets):
            if t.is_zero():
                continue
            color = self.SLOT_COLORS[slot]
            cx, cy = self._world_to_canvas(t.x, t.y)
            self.canvas.create_oval(cx - 9, cy - 9, cx + 9, cy + 9,
                                    fill=color, outline='#fff', width=2)
            label = f'#{slot + 1}  ({t.x:+5d}, {t.y:5d}) {t.speed:+4d} cm/s'
            self.canvas.create_text(
                cx + 14, cy - 14, text=label, fill=color,
                font=('Consolas', 10), anchor='w',
            )

    # --- tick ----------------------------------------------------------------

    def _tick(self):
        if not self.paused:
            try:
                targets = self.source.read_targets()
            except Exception as exc:  # noqa: BLE001 -- keep UI alive
                targets = []
                self._set_status(f'source error: {exc}', '#ff8080')
            else:
                self._update_state(targets)
        self._redraw()
        self.root.after(self.refresh_ms, self._tick)

    def _update_state(self, targets):
        for slot in range(3):
            t = targets[slot] if slot < len(targets) else Target(0, 0, 0)
            if not t.is_zero():
                self.trails[slot].append((t.x, t.y))
        event = self.tracker.update([(t.x, t.y, t.speed) for t in targets])
        if event:
            self.last_event = event
            self.last_event_at = time.monotonic()
        # cache for redraw
        self._targets = targets

    def _redraw(self):
        self.canvas.delete('all')
        self._draw_grid()
        self._draw_zone()
        self._draw_trails()
        self._draw_sensor()
        targets = getattr(self, '_targets', [])
        self._draw_targets(targets)
        self._refresh_status(targets)

    def _refresh_status(self, targets):
        active = sum(1 for t in targets if not t.is_zero())
        present = self.tracker.is_present
        state = 'PRESENT' if present else 'ABSENT'
        color = '#3aff3a' if present else '#ff8080'
        elapsed = time.monotonic() - self.last_event_at
        last = self.last_event or '-'
        msg = (f' state: {state}    targets: {active}/3    '
               f'last event: {last} ({elapsed:5.1f} s ago)    '
               f'[q quit  f fullscreen  space pause  c clear]')
        self.status.config(text=msg, fg=color)

    def _set_status(self, text, color='#fff'):
        self.status.config(text=text, fg=color)

    # --- keys ----------------------------------------------------------------

    def quit(self):
        try:
            self.source.close()
        finally:
            self.root.destroy()

    def toggle_fullscreen(self):
        self.fullscreen = not self.fullscreen
        self.root.attributes('-fullscreen', self.fullscreen)

    def toggle_pause(self):
        self.paused = not self.paused

    def clear_trails(self):
        for trail in self.trails:
            trail.clear()


def main():
    parser = argparse.ArgumentParser(description='LD2450 radar viewer')
    parser.add_argument('--simulate', action='store_true',
                        help='use a built-in fake target instead of UART')
    parser.add_argument('--port', default='/dev/ttyAMA0',
                        help='serial port (default: /dev/ttyAMA0)')
    parser.add_argument('--baud', type=int, default=256000,
                        help='baud rate (default: 256000)')
    args = parser.parse_args()

    if args.simulate:
        source = SimulatorSource()
    else:
        source = SerialSource(args.port, args.baud)

    root = tk.Tk()
    RadarViewer(root, source)
    root.mainloop()


if __name__ == '__main__':
    main()
