#!/usr/bin/env python3
"""Test which bytes change when you move in front of the radar.

Shows raw hex data for each frame's first target. By moving in different
directions and watching which bytes change, we can identify X, Y coordinates.

Usage:
    python3 test_movement.py

Instructions:
    1. Stand STILL for 3 seconds
    2. Move LEFT slowly
    3. Move RIGHT slowly
    4. Move CLOSER to radar
    5. Move FARTHER from radar

Watch which hex bytes change!
"""

import serial
import sys
from ld2450_daemon import FRAME_HEADER, FRAME_FOOTER, FRAME_LEN

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000

print("=" * 70)
print("MOVEMENT TEST - Watch which bytes change!")
print("=" * 70)
print("\nInstructions:")
print("  1. Stand STILL for 3 seconds")
print("  2. Move LEFT slowly")
print("  3. Move RIGHT slowly")
print("  4. Move CLOSER to radar")
print("  5. Move FARTHER from radar")
print("\nPress Ctrl+C to stop")
print("=" * 70)
print()

try:
    ser = serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=1)
except serial.SerialException as e:
    print(f"✗ Error: {e}")
    sys.exit(1)

buffer = b""
frame_count = 0
prev_target = None

print("Byte positions in target data (8 bytes):")
print("  [0-1] [2-3] [4-5] [6-7]")
print()

try:
    while frame_count < 50:
        data = ser.read(1024)
        if data:
            buffer += data

            idx = buffer.find(FRAME_HEADER)
            if idx >= 0 and idx + FRAME_LEN <= len(buffer):
                frame = buffer[idx:idx + FRAME_LEN]

                if frame[-2:] == FRAME_FOOTER:
                    frame_count += 1

                    # Extract first target (8 bytes starting at offset 4)
                    target1 = frame[4:12]

                    # Show frame number and hex data
                    hex_str = ' '.join(f'{b:02x}' for b in target1)
                    print(f"Frame {frame_count:2d}: {hex_str}", end='')

                    # Show which bytes changed from previous frame
                    if prev_target:
                        changes = []
                        for i in range(len(target1)):
                            if target1[i] != prev_target[i]:
                                changes.append(f"[{i}]")
                        if changes:
                            print(f"  ← changed: {' '.join(changes)}")
                        else:
                            print("  (no change)")
                    else:
                        print()

                    prev_target = target1
                    buffer = buffer[idx + FRAME_LEN:]

except KeyboardInterrupt:
    print("\n\n✓ Stopped")
finally:
    ser.close()

print(f"\nCaptured {frame_count} frames")
print("\nAnalysis:")
print("  - Bytes that changed when moving LEFT/RIGHT = X coordinate")
print("  - Bytes that changed when moving CLOSER/FARTHER = Y coordinate (distance)")
