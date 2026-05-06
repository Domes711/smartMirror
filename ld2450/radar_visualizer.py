#!/usr/bin/env python3
"""Real-time visualization of LD2450 radar targets.

Shows detected targets as dots on a 2D grid with the detection zone
highlighted. Useful for testing radar placement and zone configuration.

Usage:
    python3 radar_visualizer.py

Controls:
    ESC or Q - Quit
    SPACE - Toggle detection zone highlight

Requirements:
    pip3 install pygame
"""

import sys
import time
import pygame
from ld2450_daemon import (
    parse_frame,
    PRESENCE_X_MM,
    PRESENCE_Y_MM,
    FRAME_HEADER,
    FRAME_LEN,
)

try:
    import serial
except ImportError:
    print("Error: pyserial not installed")
    print("Install with: sudo apt install python3-serial")
    sys.exit(1)

# Display settings
WINDOW_WIDTH = 800
WINDOW_HEIGHT = 600
FPS = 30

# Radar coordinate system (mm)
MAX_X = 600  # ±600mm display range
MAX_Y = 2000  # 2000mm depth display range

# Colors
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREEN = (0, 255, 0)
RED = (255, 0, 0)
BLUE = (0, 100, 255)
YELLOW = (255, 255, 0)
GRAY = (50, 50, 50)
LIGHT_GRAY = (100, 100, 100)

SERIAL_DEVICE = "/dev/ttyAMA0"
SERIAL_BAUD = 256000


def mm_to_screen(x_mm, y_mm, width, height):
    """Convert radar coordinates (mm) to screen coordinates (pixels)."""
    # X: -MAX_X to +MAX_X -> 0 to width
    screen_x = int((x_mm + MAX_X) / (2 * MAX_X) * width)
    # Y: 0 to MAX_Y -> height to 0 (inverted, 0 is at bottom)
    screen_y = int(height - (y_mm / MAX_Y * height))
    return screen_x, screen_y


def draw_grid(screen, width, height):
    """Draw background grid."""
    # Vertical lines every 200mm
    for x_mm in range(-MAX_X, MAX_X + 1, 200):
        screen_x, _ = mm_to_screen(x_mm, 0, width, height)
        pygame.draw.line(screen, GRAY, (screen_x, 0), (screen_x, height), 1)

    # Horizontal lines every 200mm
    for y_mm in range(0, MAX_Y + 1, 200):
        _, screen_y = mm_to_screen(0, y_mm, width, height)
        pygame.draw.line(screen, GRAY, (0, screen_y), (width, screen_y), 1)

    # Center line (X=0)
    center_x, _ = mm_to_screen(0, 0, width, height)
    pygame.draw.line(screen, LIGHT_GRAY, (center_x, 0), (center_x, height), 2)


def draw_detection_zone(screen, width, height, show_zone):
    """Draw the detection zone rectangle."""
    if not show_zone:
        return

    # Zone corners
    top_left = mm_to_screen(-PRESENCE_X_MM, PRESENCE_Y_MM, width, height)
    top_right = mm_to_screen(PRESENCE_X_MM, PRESENCE_Y_MM, width, height)
    bottom_left = mm_to_screen(-PRESENCE_X_MM, 0, width, height)
    bottom_right = mm_to_screen(PRESENCE_X_MM, 0, width, height)

    # Draw zone rectangle
    points = [top_left, top_right, bottom_right, bottom_left]
    pygame.draw.polygon(screen, YELLOW, points, 3)

    # Draw zone fill (semi-transparent)
    s = pygame.Surface((width, height), pygame.SRCALPHA)
    pygame.draw.polygon(s, (*YELLOW, 30), points)
    screen.blit(s, (0, 0))


def draw_targets(screen, targets, width, height):
    """Draw detected targets as dots."""
    for x_mm, y_mm, speed in targets:
        screen_x, screen_y = mm_to_screen(x_mm, y_mm, width, height)

        # Check if in detection zone
        in_zone = abs(x_mm) <= PRESENCE_X_MM and 0 < y_mm <= PRESENCE_Y_MM
        color = GREEN if in_zone else RED

        # Draw target
        pygame.draw.circle(screen, color, (screen_x, screen_y), 10)
        pygame.draw.circle(screen, WHITE, (screen_x, screen_y), 10, 2)

        # Draw speed indicator (line)
        if abs(speed) > 5:  # Only show if moving
            line_end = (screen_x, screen_y - int(speed * 0.5))
            pygame.draw.line(screen, color, (screen_x, screen_y), line_end, 2)


def draw_info(screen, font, targets, frame_count, fps_actual):
    """Draw info overlay."""
    y_offset = 10
    line_height = 25

    texts = [
        f"FPS: {fps_actual:.1f}",
        f"Frames: {frame_count}",
        f"Targets: {len(targets)}",
        f"Zone: ±{PRESENCE_X_MM}mm x {PRESENCE_Y_MM}mm",
        "",
        "Controls:",
        "  SPACE - Toggle zone",
        "  ESC/Q - Quit"
    ]

    for i, text in enumerate(texts):
        color = WHITE if text else GRAY
        label = font.render(text, True, color)
        screen.blit(label, (10, y_offset + i * line_height))


def main():
    # Initialize pygame
    pygame.init()
    screen = pygame.display.set_mode((WINDOW_WIDTH, WINDOW_HEIGHT))
    pygame.display.set_caption("LD2450 Radar Visualizer")
    clock = pygame.time.Clock()
    font = pygame.font.SysFont("monospace", 16)

    # Open serial connection
    try:
        ser = serial.Serial(SERIAL_DEVICE, SERIAL_BAUD, timeout=0.1)
        print(f"✓ Connected to {SERIAL_DEVICE} @ {SERIAL_BAUD} baud")
    except serial.SerialException as e:
        print(f"✗ Error opening {SERIAL_DEVICE}: {e}")
        return 1

    # State
    running = True
    show_zone = True
    frame_count = 0
    targets = []
    buffer = b""
    fps_counter = []

    print("Radar visualizer started. Press ESC or Q to quit.")

    try:
        while running:
            frame_start = time.time()

            # Handle events
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                elif event.type == pygame.KEYDOWN:
                    if event.key in (pygame.K_ESCAPE, pygame.K_q):
                        running = False
                    elif event.key == pygame.K_SPACE:
                        show_zone = not show_zone

            # Read serial data
            data = ser.read(1024)
            if data:
                buffer += data

                # Try to parse Engineering mode frames from buffer
                while len(buffer) >= FRAME_LEN:
                    # Look for Engineering mode frame header
                    header_idx = buffer.find(FRAME_HEADER)
                    if header_idx == -1:
                        buffer = buffer[-FRAME_LEN:]  # Keep last bytes for sync
                        break

                    if header_idx > 0:
                        buffer = buffer[header_idx:]  # Discard junk before header

                    # Check if we have full frame
                    if len(buffer) < FRAME_LEN:
                        break

                    # Parse frame
                    frame = buffer[:FRAME_LEN]
                    targets = parse_frame(frame)
                    frame_count += 1
                    buffer = buffer[FRAME_LEN:]

            # Calculate FPS
            fps_counter.append(time.time())
            fps_counter = [t for t in fps_counter if time.time() - t < 1.0]
            fps_actual = len(fps_counter)

            # Draw
            screen.fill(BLACK)
            draw_grid(screen, WINDOW_WIDTH, WINDOW_HEIGHT)
            draw_detection_zone(screen, WINDOW_WIDTH, WINDOW_HEIGHT, show_zone)
            draw_targets(screen, targets, WINDOW_WIDTH, WINDOW_HEIGHT)
            draw_info(screen, font, targets, frame_count, fps_actual)

            pygame.display.flip()
            clock.tick(FPS)

    except KeyboardInterrupt:
        print("\n✓ Interrupted by user")
    finally:
        ser.close()
        pygame.quit()

    print(f"✓ Received {frame_count} frames")
    return 0


if __name__ == "__main__":
    sys.exit(main())
