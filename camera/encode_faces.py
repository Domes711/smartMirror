#!/usr/bin/env python3
"""Encode faces from training photos into pickle file.

Walks through dataset/{name}/ folders, detects faces in all images,
encodes them using face_recognition, and saves to encoded_faces.pickle.

The output format matches what face_reco_once.py expects:
    {"encodings": [...], "names": [...]}

Usage:
    python3 encode_faces.py
    python3 encode_faces.py --dataset ./dataset --output ./encoded_faces.pickle
    python3 encode_faces.py --detection-method cnn  # slower but more accurate
"""

import argparse
import pickle
import sys
from pathlib import Path

DEFAULT_DATASET_DIR = Path(__file__).parent / "dataset"
DEFAULT_OUTPUT = Path(__file__).parent / "encoded_faces.pickle"
DEFAULT_DETECTION_METHOD = "hog"  # "hog" (fast, CPU) or "cnn" (accurate, GPU)


def encode_faces(dataset_dir: Path, output_path: Path, detection_method: str) -> None:
    """Encode all faces from dataset and save to pickle."""
    try:
        import face_recognition
        import cv2
    except ImportError as exc:
        print(f"ERROR: {exc}")
        print("Install with: pip3 install face_recognition opencv-python")
        sys.exit(1)

    if not dataset_dir.exists():
        print(f"ERROR: Dataset directory not found: {dataset_dir}")
        sys.exit(1)

    print(f"🔍 Scanning dataset: {dataset_dir}")
    print(f"📦 Output: {output_path}")
    print(f"🧠 Detection method: {detection_method}")
    print()

    known_encodings = []
    known_names = []

    # Walk through each person's folder
    person_dirs = [d for d in dataset_dir.iterdir() if d.is_dir()]
    if not person_dirs:
        print(f"ERROR: No person folders found in {dataset_dir}")
        print("Expected structure: dataset/PersonName/*.jpg")
        sys.exit(1)

    for person_dir in sorted(person_dirs):
        name = person_dir.name
        image_paths = list(person_dir.glob("*.jpg")) + list(person_dir.glob("*.png"))

        if not image_paths:
            print(f"⚠️  Skipping {name}: no images found")
            continue

        print(f"👤 Processing {name}: {len(image_paths)} images")

        for i, image_path in enumerate(sorted(image_paths), 1):
            print(f"   [{i}/{len(image_paths)}] {image_path.name}... ", end="", flush=True)

            # Load image
            image = cv2.imread(str(image_path))
            if image is None:
                print("❌ failed to load")
                continue

            # Convert BGR (OpenCV) to RGB (face_recognition)
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

            # Detect faces
            boxes = face_recognition.face_locations(rgb, model=detection_method)
            if not boxes:
                print("⚠️  no face detected")
                continue

            # Encode faces
            encodings = face_recognition.face_encodings(rgb, boxes)
            if not encodings:
                print("⚠️  encoding failed")
                continue

            # Use the first face if multiple detected
            if len(boxes) > 1:
                print(f"⚠️  {len(boxes)} faces detected, using first")

            known_encodings.append(encodings[0])
            known_names.append(name)
            print("✓")

    print()
    print(f"📊 Total encodings: {len(known_encodings)}")

    if not known_encodings:
        print("ERROR: No faces were successfully encoded!")
        sys.exit(1)

    # Count per person
    from collections import Counter
    counts = Counter(known_names)
    for name, count in sorted(counts.items()):
        print(f"   {name}: {count} photos")

    # Save to pickle
    print()
    print(f"💾 Saving to {output_path}... ", end="", flush=True)
    data = {"encodings": known_encodings, "names": known_names}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        pickle.dump(data, f)
    print("✓")

    print()
    print("✅ Done! You can now use face_reco_once.py")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Encode faces from training photos."
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=DEFAULT_DATASET_DIR,
        help=f"Dataset directory (default: {DEFAULT_DATASET_DIR})"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output pickle path (default: {DEFAULT_OUTPUT})"
    )
    parser.add_argument(
        "--detection-method",
        choices=["hog", "cnn"],
        default=DEFAULT_DETECTION_METHOD,
        help=f"Face detection method (default: {DEFAULT_DETECTION_METHOD}). "
             "hog=fast (CPU), cnn=accurate (GPU/slow on Pi)"
    )
    args = parser.parse_args()

    encode_faces(args.dataset, args.output, args.detection_method)
    return 0


if __name__ == "__main__":
    sys.exit(main())
