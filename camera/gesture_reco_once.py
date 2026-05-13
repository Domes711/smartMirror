#!/usr/bin/env python3
"""On-demand gesture recognition for smart mirror with finger counting.

Captures camera stream and recognizes hand gestures (finger counting 0-5).
Uses MediaPipe Hands for hand detection and landmark tracking.

Usage:
    python3 gesture_reco_once.py
    python3 gesture_reco_once.py --preview          # Show live camera view (for testing)
    python3 gesture_reco_once.py --max-duration 5   # Scan for 5 seconds max
    python3 gesture_reco_once.py --confidence 0.7   # Detection confidence threshold
"""

import argparse
import json
import logging
import sys
import time
import paho.mqtt.client as mqtt

DEFAULT_MQTT_BROKER = "127.0.0.1"
DEFAULT_MQTT_PORT = 1883
MQTT_TOPIC_GESTURE = "smartmirror/camera/gesture"
DEFAULT_MAX_DURATION = 10.0  # seconds to scan for gestures
DEFAULT_WARMUP_SEC = 0.5
DEFAULT_CONFIDENCE = 0.6  # MediaPipe detection confidence
FRAME_INTERVAL = 0.1  # seconds between gesture detection attempts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s gesture_reco: %(message)s",
)
log = logging.getLogger("gesture_reco")


def mqtt_publish(client: mqtt.Client, topic: str, payload: dict) -> None:
    """Publish gesture result to MQTT. Failures are logged, never raised."""
    try:
        data = json.dumps(payload)
        result = client.publish(topic, data, qos=1)
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            log.info("MQTT published: %s -> %s", topic, data)
        else:
            log.warning("MQTT publish failed: rc=%d", result.rc)
    except Exception as exc:  # noqa: BLE001
        log.warning("MQTT publish error: %s", exc)


def count_fingers(hand_landmarks, handedness) -> int:
    """Count extended fingers from MediaPipe hand landmarks.

    Returns number of extended fingers (0-5).

    MediaPipe hand landmarks:
    - 0: WRIST
    - 1-4: THUMB (CMC, MCP, IP, TIP)
    - 5-8: INDEX (MCP, PIP, DIP, TIP)
    - 9-12: MIDDLE (MCP, PIP, DIP, TIP)
    - 13-16: RING (MCP, PIP, DIP, TIP)
    - 17-20: PINKY (MCP, PIP, DIP, TIP)
    """
    landmarks = hand_landmarks.landmark

    # Finger tip and pip landmark indices
    # Format: (tip_id, pip_id) for each finger
    finger_tips = [
        (4, 2),   # Thumb (TIP, IP) - special case
        (8, 6),   # Index (TIP, PIP)
        (12, 10), # Middle (TIP, PIP)
        (16, 14), # Ring (TIP, PIP)
        (20, 18), # Pinky (TIP, PIP)
    ]

    count = 0

    # Check thumb separately (horizontal comparison for left/right hand)
    thumb_tip = landmarks[4]
    thumb_ip = landmarks[2]

    # Determine if it's left or right hand
    is_right_hand = handedness.classification[0].label == "Right"

    # Thumb is extended if tip is further from wrist than IP joint
    # For right hand: tip.x > ip.x, for left hand: tip.x < ip.x
    if is_right_hand:
        if thumb_tip.x < thumb_ip.x:  # Note: MediaPipe mirrors horizontally
            count += 1
    else:
        if thumb_tip.x > thumb_ip.x:
            count += 1

    # Check other four fingers (vertical comparison)
    for tip_id, pip_id in finger_tips[1:]:
        tip = landmarks[tip_id]
        pip = landmarks[pip_id]

        # Finger is extended if tip is above (lower y value) than PIP joint
        if tip.y < pip.y:
            count += 1

    return count


def recognize_gesture_stream(
    max_duration: float,
    confidence: float,
    warmup_sec: float,
    show_preview: bool = False,
):
    """Scan camera stream for up to max_duration seconds, return first gesture.

    Returns (gesture_type, count, elapsed_time):
        ("finger_count", 3, 2.1) on successful detection,
        (None, None, 10.0) if no hand detected within timeout.
    """
    try:
        from picamera2 import Picamera2
        import cv2
        import mediapipe as mp
    except ImportError as exc:
        log.error("Import failed: %s", exc)
        return None, None, 0.0

    # Initialize MediaPipe Hands
    mp_hands = mp.solutions.hands
    mp_drawing = mp.solutions.drawing_utils
    mp_drawing_styles = mp.solutions.drawing_styles

    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=confidence,
        min_tracking_confidence=confidence,
    )

    # Initialize camera
    picam = Picamera2()
    config = picam.create_preview_configuration(
        main={"size": (640, 480), "format": "RGB888"}
    )
    picam.configure(config)
    picam.start()

    try:
        # Warm-up
        time.sleep(max(0.0, warmup_sec))

        start_time = time.time()
        last_attempt = 0
        frames_checked = 0

        log.info("Scanning for hand gestures (max %.1fs)...", max_duration)

        while True:
            elapsed = time.time() - start_time

            # Timeout check
            if elapsed >= max_duration:
                log.info("Timeout after %.1fs, no gesture detected", elapsed)
                return None, None, elapsed

            # Grab frame
            frame = picam.capture_array()

            # Show preview if requested
            if show_preview:
                # Convert RGB to BGR for OpenCV display
                display_frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                remaining = max(0, int(max_duration - elapsed))
                cv2.putText(display_frame, f"Scanning... {remaining}s", (10, 30),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                cv2.putText(display_frame, f"Frames: {frames_checked}", (10, 60),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

            # Rate limiting: only check every FRAME_INTERVAL seconds
            if elapsed - last_attempt < FRAME_INTERVAL:
                if show_preview:
                    cv2.imshow("Gesture Recognition - Press 'q' to abort", display_frame)
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        log.warning("Aborted by user")
                        cv2.destroyAllWindows()
                        return None, None, elapsed
                else:
                    time.sleep(0.05)
                continue

            last_attempt = elapsed
            frames_checked += 1

            # Convert BGR to RGB for MediaPipe (Picamera2 already outputs RGB888)
            rgb_frame = frame

            # Process frame with MediaPipe
            results = hands.process(rgb_frame)

            if not results.multi_hand_landmarks:
                if show_preview:
                    cv2.imshow("Gesture Recognition - Press 'q' to abort", display_frame)
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        log.warning("Aborted by user")
                        cv2.destroyAllWindows()
                        return None, None, elapsed
                continue  # No hand in this frame

            # Hand detected! Count fingers
            hand_landmarks = results.multi_hand_landmarks[0]
            handedness = results.multi_handedness[0]
            finger_count = count_fingers(hand_landmarks, handedness)

            log.info("Detected %d fingers after %.1fs (%d frames)",
                    finger_count, elapsed, frames_checked)

            # Show result in preview
            if show_preview:
                display_frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

                # Draw hand landmarks
                mp_drawing.draw_landmarks(
                    display_frame,
                    hand_landmarks,
                    mp_hands.HAND_CONNECTIONS,
                    mp_drawing_styles.get_default_hand_landmarks_style(),
                    mp_drawing_styles.get_default_hand_connections_style(),
                )

                cv2.putText(display_frame, f"Fingers: {finger_count}", (10, 90),
                           cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
                cv2.imshow("Gesture Recognition - Press 'q' to abort", display_frame)
                cv2.waitKey(2000)  # Show for 2s
                cv2.destroyAllWindows()

            return "finger_count", finger_count, elapsed

    finally:
        picam.stop()
        hands.close()
        if show_preview:
            try:
                cv2.destroyAllWindows()
            except:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(
        description="On-demand gesture recognition with finger counting."
    )
    parser.add_argument("--mqtt-broker", default=DEFAULT_MQTT_BROKER,
                        help=f"MQTT broker address (default: {DEFAULT_MQTT_BROKER})")
    parser.add_argument("--mqtt-port", type=int, default=DEFAULT_MQTT_PORT,
                        help=f"MQTT broker port (default: {DEFAULT_MQTT_PORT})")
    parser.add_argument("--max-duration", type=float, default=DEFAULT_MAX_DURATION,
                        help=f"max seconds to scan for gestures (default: {DEFAULT_MAX_DURATION})")
    parser.add_argument("--warmup-sec", type=float, default=DEFAULT_WARMUP_SEC,
                        help="camera warm-up before scanning")
    parser.add_argument("--confidence", type=float, default=DEFAULT_CONFIDENCE,
                        help="MediaPipe detection confidence threshold")
    parser.add_argument("--preview", action="store_true",
                        help="show live camera preview (for testing)")
    args = parser.parse_args()

    # Setup MQTT client
    mqtt_client = mqtt.Client(client_id="gesture_reco")
    try:
        mqtt_client.connect(args.mqtt_broker, args.mqtt_port, 60)
        mqtt_client.loop_start()
        log.info("MQTT connected to %s:%d", args.mqtt_broker, args.mqtt_port)
    except Exception as exc:
        log.error("MQTT connection failed: %s", exc)
        return 1

    try:
        gesture_type, count, elapsed = recognize_gesture_stream(
            args.max_duration,
            args.confidence,
            args.warmup_sec,
            args.preview,
        )

        if gesture_type:
            payload = {
                "gesture": gesture_type,
                "count": count,
                "elapsed": round(elapsed, 2),
            }
            mqtt_publish(mqtt_client, MQTT_TOPIC_GESTURE, payload)
            log.info("Gesture recognized: %s with %d fingers", gesture_type, count)
        else:
            mqtt_publish(mqtt_client, MQTT_TOPIC_GESTURE, {"gesture": None})
            log.info("No gesture detected after %.1fs", elapsed)

        return 0

    except Exception as exc:  # noqa: BLE001 -- always exit clean
        log.exception("gesture recognition failed: %s", exc)
        try:
            mqtt_publish(mqtt_client, MQTT_TOPIC_GESTURE, {"gesture": None})
        except Exception:  # noqa: BLE001
            pass
        return 0
    finally:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


if __name__ == "__main__":
    sys.exit(main())
