#!/usr/bin/env python3
"""Analyze LD2450 radar protocol to identify frame format.

The LD2450 can output data in different formats. This script captures
raw data and analyzes it to identify which protocol is being used,
helping diagnose parsing issues.

Usage:
    python3 analyze_protocol.py
"""

import serial
import sys

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000
CAPTURE_BYTES = 10000


def main():
    try:
        ser = serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=2)
        print(f"✓ Connected to {SERIAL_DEVICE} @ {SERIAL_BAUD} baud")
        print(f"Capturing {CAPTURE_BYTES} bytes...\n")

        data = ser.read(CAPTURE_BYTES)
        ser.close()

        if not data:
            print("✗ No data received. Check radar power and wiring.")
            return 1

    except serial.SerialException as e:
        print(f"✗ Error: {e}")
        return 1

    print(f"✓ Received {len(data)} bytes\n")
    print("=" * 70)
    print("Analyzing for known frame headers...\n")

    # Known LD2450 protocol headers
    patterns = {
        'Standard mode (FD FC FB FA)': bytes([0xFD, 0xFC, 0xFB, 0xFA]),
        'Engineering mode (AA FF 03 00)': bytes([0xAA, 0xFF, 0x03, 0x00]),
        'Simple mode (55 CC AA FF)': bytes([0x55, 0xCC, 0xAA, 0xFF]),
        'Alt header 1 (F4 F3 F2 F1)': bytes([0xF4, 0xF3, 0xF2, 0xF1]),
        'Alt header 2 (F1 F2 F3 F4)': bytes([0xF1, 0xF2, 0xF3, 0xF4]),
    }

    found_any = False
    for name, pattern in patterns.items():
        count = data.count(pattern)
        if count > 0:
            found_any = True
            idx = data.find(pattern)
            print(f"✓ {name}")
            print(f"  Found: {count} times")
            print(f"  First at byte: {idx}")
            print(f"  Context (20 bytes): {data[idx:idx+20].hex(' ')}")

            # Show frame structure
            if idx + 30 <= len(data):
                print(f"  Full frame (30 bytes): {data[idx:idx+30].hex(' ')}")
            print()

    if not found_any:
        print("✗ No known headers found!")
        print("\nSearching for repeating patterns...")

        # Look for any repeating 4-byte sequences
        for i in range(len(data) - 4):
            pattern = data[i:i+4]
            count = data.count(pattern)
            if count > 5:  # Appears at least 5 times
                print(f"  Pattern {pattern.hex(' ')} appears {count} times")
                if count > 10:
                    break

    print("\n" + "=" * 70)
    print("Raw data sample (first 200 bytes):\n")

    # Print in rows of 16 bytes
    for i in range(0, min(200, len(data)), 16):
        chunk = data[i:i+16]
        hex_str = ' '.join(f'{b:02x}' for b in chunk)
        ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        print(f"{i:04x}:  {hex_str:<48}  {ascii_str}")

    print("\n" + "=" * 70)
    print("\nConclusion:")
    if b'\xaa\xff\x03\x00' in data:
        print("✓ Radar is in ENGINEERING MODE (AA FF 03 00)")
        print("  This is a different format than the standard mode.")
        print("  Parser needs to be updated to handle this format.")
    elif b'\xfd\xfc\xfb\xfa' in data:
        print("✓ Radar is in STANDARD MODE (FD FC FB FA)")
        print("  This is the expected format.")
    else:
        print("? Unknown protocol detected.")
        print("  The radar may need to be configured or the baud rate may be wrong.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
