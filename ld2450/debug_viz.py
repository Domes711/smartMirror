#!/usr/bin/env python3
"""Debug script for LD2450 radar - shows raw target data with zone status.

Reads radar frames and displays each target's coordinates and whether
it's inside the detection zone. Useful for debugging why visualizer
might not show targets.

Usage:
    python3 debug_viz.py
    python3 debug_viz.py --frames 50  # Read 50 frames then exit

Press Ctrl+C to stop.
"""

import argparse
import serial
import sys
from ld2450_daemon import parse_frame, PRESENCE_X_MM, PRESENCE_Y_MM

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000
DEFAULT_FRAMES = 100


def main():
    parser = argparse.ArgumentParser(
        description="Debug LD2450 radar target detection."
    )
    parser.add_argument(
        "--frames",
        type=int,
        default=DEFAULT_FRAMES,
        help=f"Number of frames to capture (default: {DEFAULT_FRAMES})"
    )
    args = parser.parse_args()

    try:
        ser = serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=1)
        print(f"✓ Connected to {SERIAL_DEVICE} @ {SERIAL_BAUD} baud")
    except serial.SerialException as e:
        print(f"✗ Error: {e}")
        return 1

    buffer = b""
    frame_count = 0
    targets_seen = 0

    print(f"\nReading radar data (up to {args.frames} frames)...")
    print(f"Detection zone: ±{PRESENCE_X_MM}mm (X) × 0-{PRESENCE_Y_MM}mm (Y)")
    print("Stand in front of the radar!\n")
    print("=" * 70)

    try:
        while frame_count < args.frames:
            data = ser.read(1024)
            if data:
                buffer += data

                # Look for frame header
                header_idx = buffer.find(b'\xfd\xfc\xfb\xfa')
                if header_idx >= 0:
                    buffer = buffer[header_idx:]

                    if len(buffer) >= 30:
                        frame = buffer[:30]
                        targets = parse_frame(frame)

                        if targets:
                            frame_count += 1
                            targets_seen += len(targets)

                            print(f"Frame {frame_count:3d} - {len(targets)} target(s):")
                            for i, (x, y, speed) in enumerate(targets):
                                # Check if target is in detection zone
                                in_zone = abs(x) <= PRESENCE_X_MM and 0 < y <= PRESENCE_Y_MM
                                status = "✓ IN ZONE" if in_zone else "  outside"

                                # Skip (0,0) targets (no detection)
                                if x == 0 and y == 0:
                                    status = "  (empty)"

                                print(f"  Target {i+1}: "
                                      f"X={x:5d}mm  Y={y:5d}mm  "
                                      f"Speed={speed:3d}cm/s  {status}")
                            print()

                        buffer = buffer[30:]

    except KeyboardInterrupt:
        print("\n" + "=" * 70)
        print("✓ Interrupted by user")
    finally:
        ser.close()

    print(f"\n✓ Statistics:")
    print(f"  Frames processed: {frame_count}")
    print(f"  Targets detected: {targets_seen}")
    if frame_count > 0:
        print(f"  Avg targets/frame: {targets_seen / frame_count:.2f}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
