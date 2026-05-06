#!/usr/bin/env python3
"""Very simple test - read raw data and try to parse it."""

import serial
import sys

# Import updated parser
from ld2450_daemon import parse_frame, FRAME_HEADER, FRAME_FOOTER, FRAME_LEN

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000

print(f"Looking for header: {FRAME_HEADER.hex(' ')}")
print(f"Looking for footer: {FRAME_FOOTER.hex(' ')}")
print(f"Frame length: {FRAME_LEN} bytes\n")

try:
    ser = serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=1)
    print(f"✓ Connected to {SERIAL_DEVICE}")
except Exception as e:
    print(f"✗ Error: {e}")
    sys.exit(1)

buffer = b""
frames_found = 0
bytes_read = 0

print("Reading data...\n")

try:
    while frames_found < 10:
        data = ser.read(1024)
        if data:
            bytes_read += len(data)
            buffer += data

            # Look for header
            while True:
                idx = buffer.find(FRAME_HEADER)
                if idx == -1:
                    # Keep last 30 bytes for potential partial frame
                    buffer = buffer[-30:] if len(buffer) > 30 else buffer
                    break

                # Check if we have full frame
                if idx + FRAME_LEN <= len(buffer):
                    frame = buffer[idx:idx + FRAME_LEN]

                    # Verify footer
                    if frame[-2:] == FRAME_FOOTER:
                        frames_found += 1
                        print(f"Frame {frames_found}:")
                        print(f"  Raw: {frame.hex(' ')}")

                        # Try to parse
                        targets = parse_frame(frame)
                        print(f"  Parsed: {len(targets)} targets")
                        for i, (x, y, speed) in enumerate(targets):
                            in_zone = abs(x) <= 400 and 0 < y <= 1500
                            status = "IN ZONE" if in_zone else "outside"
                            print(f"    T{i+1}: X={x:5d} Y={y:5d} Speed={speed:3d} {status}")
                        print()

                        buffer = buffer[idx + FRAME_LEN:]
                    else:
                        # Bad footer, skip this header
                        buffer = buffer[idx + 4:]
                else:
                    # Not enough data yet
                    break

except KeyboardInterrupt:
    print("\n✓ Stopped")
finally:
    ser.close()

print(f"\nBytes read: {bytes_read}")
print(f"Frames parsed: {frames_found}")
