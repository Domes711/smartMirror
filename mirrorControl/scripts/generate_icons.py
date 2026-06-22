#!/usr/bin/env python3
"""Generate Mirror Control PWA icons with no third-party deps (stdlib only).

Draws the wordmark glyph — a paper-coloured "mirror" outline with a red live
dot on an ink background — supersampled 3x and box-downscaled for smooth edges,
then PNG-encoded via zlib. Run: python3 scripts/generate_icons.py
"""
import os, struct, zlib

INK = (26, 26, 23)
PAPER = (233, 232, 221)
RED = (229, 72, 47)
SS = 3  # supersample factor

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")


def inside_rrect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    if (x < x0 + r or x > x1 - r) and (y < y0 + r or y > y1 - r):
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return True


def render(size, maskable=False):
    W = size * SS
    buf = bytearray()
    # geometry as fractions of `size`
    pad = 0.0  # ink is full-bleed (works for maskable + any)
    rx0, ry0, rx1, ry1 = 0.30, 0.205, 0.70, 0.795
    rrad = 0.075
    stroke = 0.05
    dot_cx, dot_cy, dot_r = 0.5, 0.315, 0.038
    s = float(W)
    for py in range(W):
        for px in range(W):
            x, y = px / s, py / s
            col = INK
            outer = inside_rrect(x, y, rx0, ry0, rx1, ry1, rrad)
            inner = inside_rrect(x, y, rx0 + stroke, ry0 + stroke, rx1 - stroke, ry1 - stroke, rrad - stroke / 2)
            if outer and not inner:
                col = PAPER
            if (x - dot_cx) ** 2 + (y - dot_cy) ** 2 <= dot_r ** 2:
                col = RED
            buf += bytes(col)
    _ = pad, maskable
    # box downscale SS x SS -> size
    out = bytearray()
    for oy in range(size):
        out.append(0)  # PNG filter byte (none) per scanline
        for ox in range(size):
            r = g = b = 0
            for dy in range(SS):
                for dx in range(SS):
                    i = (((oy * SS + dy) * W) + (ox * SS + dx)) * 3
                    r += buf[i]; g += buf[i + 1]; b += buf[i + 2]
            n = SS * SS
            out += bytes((r // n, g // n, b // n))
    return bytes(out)


def write_png(path, size, raw_rgb):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw_rgb, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [("icon-192.png", 192), ("icon-512.png", 512), ("maskable-512.png", 512), ("apple-touch-icon.png", 180), ("favicon-32.png", 32)]
    for name, size in targets:
        write_png(os.path.join(OUT, name), size, render(size))
        print("wrote", name, f"{size}x{size}")


if __name__ == "__main__":
    main()
