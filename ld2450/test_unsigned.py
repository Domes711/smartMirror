#!/usr/bin/env python3
"""Test different parsing interpretations of Engineering mode data.

Frame 2 from your radar:
aa ff 03 00 29 01 37 82 00 00 68 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 55 cc

We're getting Y=-32201 which seems wrong. Let's try different interpretations.
"""

import struct

# Target 1 data from Frame 2 (8 bytes starting at offset 4)
target_data = bytes.fromhex("29 01 37 82 00 00 68 01")

print("Testing different data interpretations:")
print("=" * 70)

print("\n1. Current parsing (X signed, Y signed):")
x = struct.unpack_from('<h', target_data, 0)[0]
y = struct.unpack_from('<h', target_data, 2)[0]
speed = struct.unpack_from('<H', target_data, 4)[0]
reserved = struct.unpack_from('<H', target_data, 6)[0]
print(f"   X={x:6d}mm  Y={y:6d}mm  Speed={speed:5d}  Reserved=0x{reserved:04x}")

print("\n2. Y as unsigned (X signed, Y unsigned):")
x = struct.unpack_from('<h', target_data, 0)[0]
y = struct.unpack_from('<H', target_data, 2)[0]
speed = struct.unpack_from('<H', target_data, 4)[0]
reserved = struct.unpack_from('<H', target_data, 6)[0]
print(f"   X={x:6d}mm  Y={y:6d}mm  Speed={speed:5d}  Reserved=0x{reserved:04x}")

print("\n3. All unsigned:")
x = struct.unpack_from('<H', target_data, 0)[0]
y = struct.unpack_from('<H', target_data, 2)[0]
speed = struct.unpack_from('<H', target_data, 4)[0]
reserved = struct.unpack_from('<H', target_data, 6)[0]
print(f"   X={x:6d}mm  Y={y:6d}mm  Speed={speed:5d}  Reserved=0x{reserved:04x}")

print("\n4. Maybe speed is at different position? (X, Y, Reserved, Speed):")
x = struct.unpack_from('<h', target_data, 0)[0]
y = struct.unpack_from('<h', target_data, 2)[0]
reserved = struct.unpack_from('<H', target_data, 4)[0]
speed = struct.unpack_from('<H', target_data, 6)[0]
print(f"   X={x:6d}mm  Y={y:6d}mm  Speed={speed:5d}  Reserved=0x{reserved:04x}")

print("\n5. Little-endian 32-bit pairs? (first 4 bytes = one value):")
val1 = struct.unpack_from('<I', target_data, 0)[0]
val2 = struct.unpack_from('<I', target_data, 4)[0]
print(f"   Value1={val1}  Value2={val2}")

print("\n6. Big-endian?")
x = struct.unpack_from('>h', target_data, 0)[0]
y = struct.unpack_from('>h', target_data, 2)[0]
speed = struct.unpack_from('>H', target_data, 4)[0]
reserved = struct.unpack_from('>H', target_data, 6)[0]
print(f"   X={x:6d}mm  Y={y:6d}mm  Speed={speed:5d}  Reserved=0x{reserved:04x}")

print("\n" + "=" * 70)
print("\nWhich interpretation makes sense?")
print("Expected: X should be ±400mm, Y should be 0-1500mm")
