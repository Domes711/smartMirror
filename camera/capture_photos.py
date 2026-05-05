#!/usr/bin/env python3
"""Capture training photos from RPi camera for face recognition.

Usage:
    python3 capture_photos.py --name Domes --count 20
    python3 capture_photos.py --name Domes --count 20 --delay 3
"""

import argparse
import os
import sys
import time
from pathlib import Path

DEFAULT_DATASET_DIR = Path(__file__).parent / "dataset"
DEFAULT_COUNT = 20
DEFAULT_DELAY = 2.0


def capture_photos(name: str, count: int, delay: float, dataset_dir: Path) -> None:
    """Capture training photos and save to dataset/{name}/ folder."""
    try:
        from picamera2 import Picamera2
    except ImportError:
        print("ERROR: picamera2 not found. Install with: sudo apt install python3-picamera2")
        sys.exit(1)

    output_dir = dataset_dir / name
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"📸 Capturing {count} photos for '{name}'")
    print(f"📁 Output: {output_dir}")
    print(f"⏱️  {delay}s delay between photos")
    print()
    print("💡 Tips:")
    print("   - Look at the camera")
    print("   - Change angle/distance between shots")
    print("   - Vary lighting if possible")
    print()
    input("Press ENTER to start...")

    picam = Picamera2()
    config = picam.create_still_configuration(main={"size": (640, 480)})
    picam.configure(config)
    picam.start()

    try:
        # Warm-up
        print("Warming up camera...")
        time.sleep(1.0)

        for i in range(1, count + 1):
            output_path = output_dir / f"{i}.jpg"

            print(f"📷 Photo {i}/{count}... ", end="", flush=True)
            frame = picam.capture_array()

            # Convert RGB to BGR for saving (if using cv2)
            # For now, use picam's built-in save
            picam.capture_file(str(output_path))

            print(f"✓ saved to {output_path.name}")

            if i < count:
                print(f"   Next photo in {delay}s (change pose now)...")
                time.sleep(delay)

    finally:
        picam.stop()

    print()
    print(f"✅ Done! {count} photos saved to {output_dir}")
    print(f"📊 Next step: python3 encode_faces.py --dataset {dataset_dir}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture training photos from RPi camera."
    )
    parser.add_argument(
        "--name",
        required=True,
        help="Person name (creates dataset/{name}/ folder)"
    )
    parser.add_argument(
        "--count",
        type=int,
        default=DEFAULT_COUNT,
        help=f"Number of photos to capture (default: {DEFAULT_COUNT})"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY,
        help=f"Delay in seconds between photos (default: {DEFAULT_DELAY})"
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=DEFAULT_DATASET_DIR,
        help=f"Dataset root directory (default: {DEFAULT_DATASET_DIR})"
    )
    args = parser.parse_args()

    capture_photos(args.name, args.count, args.delay, args.dataset)
    return 0


if __name__ == "__main__":
    sys.exit(main())
