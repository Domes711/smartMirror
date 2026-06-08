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
    python3 encode_faces.py --name Domes   # encode ONLY this profile, merge in
"""

import argparse
import pickle
import sys
from pathlib import Path

DEFAULT_DATASET_DIR = Path(__file__).parent / "dataset"
DEFAULT_OUTPUT = Path(__file__).parent / "encoded_faces.pickle"
DEFAULT_DETECTION_METHOD = "hog"  # "hog" (fast, CPU) or "cnn" (accurate, GPU)


def _encode_person(person_dir: Path, face_recognition, cv2, detection_method: str):
    """Encode every photo in one person's folder. Returns a list of encodings."""
    name = person_dir.name
    image_paths = list(person_dir.glob("*.jpg")) + list(person_dir.glob("*.png"))

    if not image_paths:
        print(f"⚠️  Skipping {name}: no images found")
        return []

    print(f"👤 Processing {name}: {len(image_paths)} images")

    encodings_out = []
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

        encodings_out.append(encodings[0])
        print("✓")

    return encodings_out


def _load_pickle(path: Path):
    """Load an existing encodings pickle, or return empty lists if absent.

    Raises on a corrupt/unreadable file so callers can decide to rebuild.
    """
    if not path.exists():
        return [], []
    with open(path, "rb") as f:
        data = pickle.load(f)
    return list(data.get("encodings", [])), list(data.get("names", []))


def _save_pickle(path: Path, encodings, names) -> None:
    print()
    print(f"💾 Saving to {path}... ", end="", flush=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump({"encodings": encodings, "names": names}, f)
    print("✓")
    print()
    print("✅ Done! You can now use face_reco_once.py")


def encode_faces(dataset_dir: Path, output_path: Path, detection_method: str,
                 only_name: str = None) -> None:
    """Encode faces from the dataset and save to pickle.

    With ``only_name`` set, encode just ``dataset/<only_name>/`` and merge the
    result into the existing pickle (replacing that person's old entries while
    keeping everyone else). This keeps "finish a new profile" fast and bounded
    instead of re-encoding the whole growing dataset on every enrollment. If the
    existing pickle can't be read, we fall back to a full rebuild so no other
    profile is silently dropped.
    """
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
    if only_name:
        print(f"🎯 Single profile: {only_name}")
    print()

    if only_name:
        person_dir = dataset_dir / only_name
        if not person_dir.is_dir():
            print(f"ERROR: Profile folder not found: {person_dir}")
            sys.exit(1)

        new_encodings = _encode_person(person_dir, face_recognition, cv2,
                                       detection_method)
        print()
        print(f"📊 Encodings for {only_name}: {len(new_encodings)}")
        if not new_encodings:
            print("ERROR: No faces were successfully encoded!")
            print("Žádná z fotek neobsahovala rozpoznatelný obličej.")
            sys.exit(1)

        # Merge into the existing pickle, replacing this person's old entries.
        try:
            existing_encs, existing_names = _load_pickle(output_path)
        except Exception as exc:  # noqa: BLE001 — corrupt pickle -> full rebuild
            print(f"⚠️  Could not read existing pickle ({exc}); rebuilding all.")
            encode_faces(dataset_dir, output_path, detection_method, only_name=None)
            return

        kept = [(e, n) for e, n in zip(existing_encs, existing_names)
                if n != only_name]
        merged_encodings = [e for e, _ in kept] + new_encodings
        merged_names = [n for _, n in kept] + [only_name] * len(new_encodings)
        _save_pickle(output_path, merged_encodings, merged_names)
        return

    # --- full dataset rebuild (default) ---
    known_encodings = []
    known_names = []

    person_dirs = [d for d in dataset_dir.iterdir() if d.is_dir()]
    if not person_dirs:
        print(f"ERROR: No person folders found in {dataset_dir}")
        print("Expected structure: dataset/PersonName/*.jpg")
        sys.exit(1)

    for person_dir in sorted(person_dirs):
        encs = _encode_person(person_dir, face_recognition, cv2, detection_method)
        known_encodings.extend(encs)
        known_names.extend([person_dir.name] * len(encs))

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

    _save_pickle(output_path, known_encodings, known_names)


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
    parser.add_argument(
        "--name",
        default=None,
        help="Encode ONLY this profile (dataset/<name>/) and merge it into the "
             "existing pickle, keeping every other profile. Omit to rebuild all."
    )
    args = parser.parse_args()

    encode_faces(args.dataset, args.output, args.detection_method, args.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
