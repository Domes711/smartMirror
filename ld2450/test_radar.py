#!/usr/bin/env python3
"""Simple test script for LD2450 radar UART communication.

Reads raw data from /dev/ttyAMA0 and displays hex output to verify
the radar is connected and sending data.

Usage:
    python3 test_radar.py

Press Ctrl+C to stop.
"""

import serial
import sys

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000

def main():
    try:
        ser = serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=1)
        print(f"✓ Connected to {SERIAL_DEVICE} @ {SERIAL_BAUD} baud")
        print("Reading from radar... (Ctrl+C to stop)")
        print("Move in front of the radar to see data changes.\n")

        bytes_received = 0
        frames = 0

        while True:
            data = ser.read(100)
            if data:
                bytes_received += len(data)
                # Look for frame header (FD FC FB FA)
                if b'\xfd\xfc\xfb\xfa' in data:
                    frames += 1

                print(f"[{bytes_received:6d} bytes, {frames:3d} frames] {data.hex()[:80]}")

    except serial.SerialException as e:
        print(f"✗ Error opening {SERIAL_DEVICE}: {e}")
        print("\nTroubleshooting:")
        print("  1. Check that UART is enabled in /boot/firmware/config.txt")
        print("  2. Check physical wiring (TX → RX, RX → TX)")
        print("  3. Verify radar has power (5V)")
        print(f"  4. Check permissions: ls -l {SERIAL_DEVICE}")
        return 1
    except KeyboardInterrupt:
        print(f"\n\n✓ Test stopped. Received {bytes_received} bytes, {frames} frames.")
        return 0
    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()

if __name__ == "__main__":
    sys.exit(main())
