#!/usr/bin/env python3
"""Capture training photos from RPi camera for face recognition.

Shows live preview with face detection overlay so you can position yourself
correctly before each photo is taken.

Usage:
    python3 capture_photos.py --name Domes --count 20
    python3 capture_photos.py --name Domes --count 20 --delay 3
"""

import argparse
import sys
import time
from pathlib import Path

DEFAULT_DATASET_DIR = Path(__file__).parent / "dataset"
DEFAULT_COUNT = 20
DEFAULT_DELAY = 3.0


def capture_photos(name: str, count: int, delay: float, dataset_dir: Path) -> None:
    """Capture training photos with live preview and face detection."""
    try:
        from picamera2 import Picamera2
        import cv2
        import numpy as np
    except ImportError as exc:
        print(f"ERROR: {exc}")
        print("Install with: sudo apt install python3-picamera2 python3-opencv")
        sys.exit(1)

    output_dir = dataset_dir / name
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"📸 Capturing {count} photos for '{name}'")
    print(f"📁 Output: {output_dir}")
    print(f"⏱️  {delay}s delay between photos")
    print()
    print("💡 Tips:")
    print("   - GREEN BOX = face detected ✓")
    print("   - RED SCREEN = no face detected ✗")
    print("   - Press 'q' to quit early")
    print("   - Change angle/distance/lighting between shots")
    print()
    input("Press ENTER to start...")

    # Initialize camera
    picam = Picamera2()
    config = picam.create_preview_configuration(
        main={"size": (640, 480), "format": "RGB888"}
    )
    picam.configure(config)
    picam.start()

    # Load face detection (Haar Cascade - faster than HOG for live preview)
    cascade_path = "/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)

    if face_cascade.empty():
        print(f"⚠️  Warning: Face cascade not found at {cascade_path}")
        print("   Continuing without face detection overlay...")
        face_cascade = None

    photos_taken = 0

    try:
        print("\n🎥 Live preview started. Position your face in the frame...")
        print("   (Window will appear on Pi's display)\n")

        time.sleep(1.5)  # Camera warm-up

        while photos_taken < count:
            # Capture frame
            frame = picam.capture_array()
            display_frame = frame.copy()

            # Detect faces
            face_detected = False
            if face_cascade is not None:
                gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
                faces = face_cascade.detectMultiScale(
                    gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60)
                )

                face_detected = len(faces) > 0

                # Draw rectangles around faces
                for (x, y, w, h) in faces:
                    cv2.rectangle(display_frame, (x, y), (x+w, y+h), (0, 255, 0), 2)

                # Add status overlay
                if not face_detected:
                    # Red tint if no face
                    red_overlay = display_frame.copy()
                    red_overlay[:, :] = [255, 50, 50]
                    display_frame = cv2.addWeighted(display_frame, 0.7, red_overlay, 0.3, 0)

            # Add info overlay
            info_text = f"Photo {photos_taken + 1}/{count}"
            status = "READY" if face_detected or face_cascade is None else "NO FACE"
            status_color = (0, 255, 0) if (face_detected or face_cascade is None) else (0, 0, 255)

            cv2.putText(display_frame, info_text, (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            cv2.putText(display_frame, status, (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, status_color, 2)

            # Show frame
            cv2.imshow("Camera Preview - Press 'q' to quit", display_frame)

            # Check for quit key
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                print("\n⚠️  Quit requested by user")
                break

            # Take photo after initial positioning
            if photos_taken == 0:
                time.sleep(2)  # Extra time for first photo

            # Countdown and capture
            for countdown in range(3, 0, -1):
                frame = picam.capture_array()
                display_frame = frame.copy()

                # Giant countdown number
                cv2.putText(display_frame, str(countdown), (250, 300),
                           cv2.FONT_HERSHEY_SIMPLEX, 5, (0, 255, 255), 10)
                cv2.imshow("Camera Preview - Press 'q' to quit", display_frame)
                cv2.waitKey(1)
                time.sleep(1)

            # CAPTURE!
            output_path = output_dir / f"{photos_taken + 1}.jpg"
            final_frame = picam.capture_array()

            # Convert RGB to BGR for saving
            bgr_frame = cv2.cvtColor(final_frame, cv2.COLOR_RGB2BGR)
            cv2.imwrite(str(output_path), bgr_frame)

            photos_taken += 1
            print(f"📷 Photo {photos_taken}/{count} saved: {output_path.name}")

            # Flash effect
            white = np.ones_like(final_frame) * 255
            cv2.imshow("Camera Preview - Press 'q' to quit", white)
            cv2.waitKey(200)

            # Wait before next photo
            if photos_taken < count:
                print(f"   Next photo in {delay}s (change pose now)...")

                # Show live preview during delay
                start_time = time.time()
                while time.time() - start_time < delay:
                    frame = picam.capture_array()
                    display_frame = frame.copy()

                    remaining = int(delay - (time.time() - start_time))
                    cv2.putText(display_frame, f"Next in {remaining}s", (10, 90),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 0), 2)

                    cv2.imshow("Camera Preview - Press 'q' to quit", display_frame)
                    if cv2.waitKey(100) & 0xFF == ord('q'):
                        break

    finally:
        picam.stop()
        cv2.destroyAllWindows()

    print()
    if photos_taken > 0:
        print(f"✅ Done! {photos_taken} photos saved to {output_dir}")
        print(f"📊 Next step: python3 encode_faces.py")
    else:
        print("❌ No photos were taken")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture training photos from RPi camera with live preview."
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
