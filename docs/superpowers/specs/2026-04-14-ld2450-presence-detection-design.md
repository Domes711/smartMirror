# LD2450 Presence Detection — Design Spec

> **EXTENDED** by [MMM-Profile design](2026-04-26-mmm-profile-design.md)
> on 2026-04-26. The radar zone parsing and GPIO relay logic in this spec
> remain accurate; the daemon additionally posts presence events to the
> mirror and triggers `face_reco_once.py` on PRESENT enter. Read this spec
> first for the radar fundamentals, then the MMM-Profile spec for the wiring.

**Date:** 2026-04-14
**Status:** Approved

## Goal

Integrate HLK-LD2450 24GHz radar sensor with MagicMirror on Raspberry Pi as a complement to face recognition. When presence is detected within 1.5m, the display turns on. After 2 minutes without presence, the display turns off — controlled via relay on GPIO17 simulating a physical button press.

## Architecture

Single Python daemon handles everything — no MagicMirror module needed for display control.

```
LD2450 (UART) → Python daemon → presence logic → GPIO17 pulse → relay → display button
```

**Components:**

1. **`ld2450_daemon.py`** — systemd service that:
   - Reads UART from `/dev/ttyAMA0` at 256000 baud
   - Parses LD2450 binary frame protocol
   - Filters targets: rectangular zone `abs(X) ≤ 400mm AND 0 < Y ≤ 1500mm` (±40cm wide, 1.5m deep)
   - Tracks state: `PRESENT` / `ABSENT`
   - On `ABSENT → PRESENT` transition: short GPIO17 pulse (turn display ON)
   - After 2 minutes continuous `ABSENT`: short GPIO17 pulse (turn display OFF)

2. **`ld2450.service`** — systemd unit file to run daemon on boot

## Physical Wiring

| LD2450 Pin | Raspberry Pi Pin | Note |
|---|---|---|
| VCC | Pin 2 (5V) | Power |
| GND | Pin 6 (GND) | Ground |
| TX | Pin 10 (GPIO15 / RXD) | UART receive |
| RX | Pin 8 (GPIO14 / TXD) | UART transmit |
| — | Pin 11 (GPIO17) | Relay control |

**Relay:** GPIO17 → relay module → in parallel with display power button

## Display Button Interface

The display power button on the monitor is a 4-pin SMD tactile switch
(`S601 POWER` on the button PCB, with debounce cap `C601` and indicator LED
`D600`). Pressing it shorts the `SIG` pin (pulled high by the monitor) to
`GNDmon`. To "press" it electronically, two thin wires are soldered onto the
two diagonally opposite pins of `S601` (the pair that is open in idle and
closed when pressed — verified with multimeter continuity).

**Polarity check (mandatory before wiring):** with the monitor in standby and
its black probe on the monitor chassis ground, measure DC voltage on each of
the two wires. One reads `~3.3 V` or `~5 V` (`SIG`), the other `~0 V`
(`GNDmon`).

Three options to drive the button from GPIO17, in order of preference:

### Option A — Direct GPIO (chosen, simplest)

Works **only if `SIG` ≤ 3.3 V** and Pi GND can be tied to `GNDmon`.

```
GPIO17 ──[1 kΩ]── SIG     (drátek A)
GND Pi ─────────── GNDmon (drátek B, společná zem povinná)
```

GPIO17 idles as `INPUT` (high-Z); to "press", switch to `OUTPUT LOW` for
100 ms, then back to `INPUT`. The 1 kΩ series resistor protects the GPIO if
it ever ends up HIGH while `SIG` is high.

**Risks:** no galvanic isolation (ground loop possible if Pi and monitor are
on different circuits without shared PE); breaks if a future monitor uses a
5 V pull-up.

### Option B — PhotoMOS / SSR (e.g. G3VM-61A1, CPC1017N, TLP222)

Bipolar, isolated, polarity-agnostic. Use this if `SIG` is 5 V or if galvanic
isolation is desired.

```
GPIO17 ──[330 Ω]──┤▶├── LED+        LED− ── GND Pi
                          ┊ izolace ┊
   SSR output ─────────────────────── across S601 (SIG ↔ GNDmon)
```

Software identical to Option A in terms of pulse timing, except GPIO17 stays
configured as `OUTPUT` and pulses HIGH for 100 ms.

### Option C — Mechanical relay module

The original spec wording. Works, but mechanical, audible, wears out. NO
contact wired in parallel with the button.

## Data Flow

**Presence detected:**
1. LD2450 sends frame with target where `abs(X) ≤ 400mm AND 0 < Y ≤ 1500mm`
2. Daemon transitions state to `PRESENT`
3. Daemon pulses GPIO17 for 100ms
4. Relay closes → simulates button press → display turns ON

**Absence timeout:**
1. No targets in zone (`abs(X) ≤ 400mm AND 0 < Y ≤ 1500mm`) for 2 minutes
2. Daemon transitions state to `ABSENT`
3. Daemon pulses GPIO17 for 100ms
4. Relay closes → simulates button press → display turns OFF

## LD2450 Protocol

Binary frames at 256000 baud. Each frame:
- Header: `FD FC FB FA`
- Data: up to 3 targets, each with X (mm), Y (mm), speed (cm/s)
- Detection zone: `abs(X) ≤ 400mm AND 0 < Y ≤ 1500mm` (rectangle ±40cm wide, 1.5m deep)
- Footer: `04 03 02 01`

## Sensor Placement

- Mounted at top of mirror, angled ~15° downward
- Detection zone: 1.5m radius, 120° horizontal FOV
- At 1.5m distance covers ~2.6m width — sufficient for standing in front of mirror

## Dependencies

- Python 3 (already on Pi)
- `pyserial` — UART communication
- `RPi.GPIO` — GPIO control
- systemd — service management

## Out of Scope

- Sending presence notifications to MagicMirror (Phase 2)
- Using radar for odchod/timeout instead of face recognition timer (Phase 2)
- Multi-zone detection
