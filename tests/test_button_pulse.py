#!/usr/bin/env python3
"""
Manual test for the display power button driven via GPIO17.

Matches Option A (direct GPIO) from
docs/superpowers/specs/2026-04-14-ld2450-presence-detection-design.md
"Display Button Interface".

Wiring:
  GPIO17 (pin 11) ──[1 kΩ]── SIG    (drátek A na S601)
  GND Pi  (pin 9) ──────────── GNDmon (drátek B na S601, společná zem)

Idle behavior:
  GPIO17 stays as INPUT (high-Z). To simulate a button press we briefly
  switch it to OUTPUT LOW (pulling SIG to GND), then back to INPUT.
  This way no current flows through GPIO17 outside the pulse window,
  even though SIG is pulled high by the monitor.

Usage (on the Pi):
  python3 ~/smartMirror/tests/test_button_pulse.py             # one 100 ms pulse on ENTER
  python3 ~/smartMirror/tests/test_button_pulse.py --pulse 200 # 200 ms pulse
  python3 ~/smartMirror/tests/test_button_pulse.py --loop 5    # press every 5 s
  python3 ~/smartMirror/tests/test_button_pulse.py --polarity  # idle high-Z, for měření napětí

Polarity check before first run:
  Spusť skript s --polarity, pak multimetrem (DC V) měř napětí mezi
  každým z obou drátků a zemí monitoru. Jeden bude ~3.3 V (SIG), druhý
  ~0 V (GNDmon). Pokud SIG > 3.3 V (např. 5 V), tuhle variantu NEPOUŽÍVEJ
  a přejdi na Option B (SSR) ve specu.
"""

import argparse
import sys
import time

try:
    import RPi.GPIO as GPIO
except ImportError:
    sys.stderr.write(
        "RPi.GPIO not installed. On the Pi run:\n"
        "  pip3 install RPi.GPIO --break-system-packages\n"
    )
    sys.exit(1)

PIN = 17  # GPIO17 = physical header pin 11


def setup_idle() -> None:
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(PIN, GPIO.IN)  # high-Z, neovlivňuje pull-up monitoru


def press(pulse_ms: int) -> None:
    """Drive GPIO17 LOW for pulse_ms milliseconds, then release."""
    GPIO.setup(PIN, GPIO.OUT, initial=GPIO.LOW)
    time.sleep(pulse_ms / 1000.0)
    GPIO.setup(PIN, GPIO.IN)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--pulse", type=int, default=100,
        help="Pulse length in ms (default 100, try 200-300 if monitor doesn't react).",
    )
    parser.add_argument(
        "--loop", type=float, default=0.0,
        help="Repeatedly press every N seconds (0 = single press on ENTER).",
    )
    parser.add_argument(
        "--polarity", action="store_true",
        help="Idle GPIO17 high-Z and wait for Ctrl-C — for multimeter measurement.",
    )
    args = parser.parse_args()

    if args.pulse <= 0 or args.pulse > 1000:
        sys.stderr.write("--pulse must be 1..1000 ms\n")
        return 2

    setup_idle()
    print("GPIO17 (pin 11) configured as INPUT (high-Z). GND on pin 9.")

    try:
        if args.polarity:
            print("Polarity mode: měř DC napětí mezi každým drátkem a zemí monitoru.")
            print("Ctrl-C pro ukončení.")
            while True:
                time.sleep(1)

        if args.loop > 0:
            print(f"Loop mode: pulse {args.pulse} ms every {args.loop} s. Ctrl-C to stop.")
            while True:
                press(args.pulse)
                print(f"  -> pulse {args.pulse} ms sent")
                time.sleep(args.loop)
        else:
            input("Press ENTER to send a single pulse (Ctrl-C to abort)... ")
            press(args.pulse)
            print(f"Pulse {args.pulse} ms sent.")
    except KeyboardInterrupt:
        print()
    finally:
        GPIO.cleanup()
        print("GPIO cleaned up.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
