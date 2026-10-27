#!/usr/bin/env python3
"""Analyze Engineering mode frames to reverse-engineer the format.

Captures multiple frames and shows how bytes change when you move
in front of the radar. Helps identify X, Y, speed byte positions.

Usage:
    python3 analyze_frames.py

Instructions:
    1. Stand still when script starts
    2. Then move slowly left/right
    3. Then move closer/farther
    4. Watch which bytes change
"""

import serial
import struct
import sys

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000

ENG_HEADER = bytes([0xAA, 0xFF, 0x03, 0x00])
ENG_FOOTER = bytes([0x55, 0xCC])
FRAME_LEN = 30


def parse_engineering_frame(data):
    """Parse Engineering mode frame (AA FF 03 00 ... 55 CC)."""
    if len(data) < FRAME_LEN:
        return None
    if data[:4] != ENG_HEADER:
        return None
    if data[28:30] != ENG_FOOTER:
        return None

    # Extract data payload (bytes 4-27, 24 bytes)
    payload = data[4:28]

    # Try to parse as 3 targets with (X, Y, speed, reserved) - 8 bytes each
    targets = []
    for i in range(0, 24, 8):
        if i + 8 > len(payload):
            break
        x = struct.unpack_from('<h', payload, i)[0]      # signed 16-bit
        y = struct.unpack_from('<h', payload, i+2)[0]    # signed 16-bit
        speed = struct.unpack_from('<H', payload, i+4)[0] # unsigned 16-bit
        reserved = struct.unpack_from('<H', payload, i+6)[0]

        # Filter out empty targets (0,0)
        if x != 0 or y != 0:
            targets.append((x, y, speed, reserved))

    return targets


def main():
    try:
        ser = serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=1)
        print(f"✓ Connected to {SERIAL_DEVICE} @ {SERIAL_BAUD} baud")
    except serial.SerialException as e:
        print(f"✗ Error: {e}")
        return 1

    print("\n" + "=" * 70)
    print("Analyzing Engineering mode frames...")
    print("Stand in front of radar and MOVE to see which bytes change!")
    print("=" * 70 + "\n")

    buffer = b""
    frame_count = 0
    prev_frame = None

    try:
        while frame_count < 50:  # Analyze 50 frames
            data = ser.read(1024)
            if data:
                buffer += data

                # Look for frame header
                idx = buffer.find(ENG_HEADER)
                if idx >= 0:
                    buffer = buffer[idx:]

                    if len(buffer) >= FRAME_LEN:
                        frame = buffer[:FRAME_LEN]
                        targets = parse_engineering_frame(frame)

                        if targets is not None:
                            frame_count += 1

                            print(f"Frame {frame_count:3d}:")
                            print(f"  Raw: {frame.hex(' ')}")

                            if targets:
                                for i, (x, y, speed, res) in enumerate(targets):
                                    print(f"  Target {i+1}: X={x:5d}mm  Y={y:5d}mm  "
                                          f"Speed={speed:3d}  Reserved=0x{res:04x}")
                            else:
                                print("  No targets")

                            # Show what changed from previous frame
                            if prev_frame:
                                changes = []
                                for i in range(len(frame)):
                                    if frame[i] != prev_frame[i]:
                                        changes.append(f"[{i}]:{prev_frame[i]:02x}→{frame[i]:02x}")
                                if changes:
                                    print(f"  Changes: {' '.join(changes[:10])}")

                            print()
                            prev_frame = frame

                        buffer = buffer[FRAME_LEN:]

    except KeyboardInterrupt:
        print("\n✓ Stopped by user")
    finally:
        ser.close()

    print(f"\n✓ Analyzed {frame_count} frames")
    return 0


if __name__ == "__main__":
    sys.exit(main())
