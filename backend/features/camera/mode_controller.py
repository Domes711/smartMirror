"""Pure decision logic for the camera's idle/face/gesture state machine —
no picamera2, no MQTT, no threading of its own. Supervisor feeds it events
(presence, a face-match result, the 5s window timing out, a manual dev-tab
override) and applies whatever mode change it returns; this mirrors
features/radar/daemon.py's RadarState/PresenceTracker split (the thread-
safety/timer/I-O concerns live in the caller, the decisions live here so
they're unit-testable with no hardware).

State machine (presence-driven, i.e. production — see MANUAL_OVERRIDE below
for how a dev-tab click changes this):

    idle --present--> face (5s window starts)
      ^                 |
      |          +------+------+
      |     recognized         no match within 5s
      |          |                   |
      |          v                   v
      |        idle                gesture (no internal timeout)
      |          ^                    |
      +--absent--+--------------------+

A manual dev-tab mode selection (apply_manual) disables presence-driving for
MANUAL_OVERRIDE_S seconds, renewed by the caller while the dev screen stays
open (same opt-in/renew/auto-expire shape as the radar feature's live-target
streaming) — presence events are still recorded while overridden, but don't
produce a mode change, and face-match results don't end the session (the
developer wants to keep watching it detect, not have it silently stop).
"""

FACE_WINDOW_S = 5.0
MANUAL_OVERRIDE_S = 20.0


class CameraModeController:
    def __init__(self):
        self.mode = "idle"
        self.presence_driven = True
        self._last_presence = "absent"
        self._manual_deadline = None  # monotonic time; None when not overridden

    # ---- dev-tab manual override ------------------------------------- #
    def apply_manual(self, mode: str, now: float) -> str:
        """A dev-tab click. Always applies immediately and takes over from
        whatever the presence state machine was doing. Returns the mode to
        apply (echoes `mode` back — the caller still owns validating it's a
        real mode name)."""
        self.presence_driven = False
        self._manual_deadline = now + MANUAL_OVERRIDE_S
        self.mode = mode
        return mode

    def renew_manual(self, now: float) -> None:
        """Call periodically while the dev tab stays open (same idea as
        radar's stream renewal) so the override doesn't expire mid-session."""
        if not self.presence_driven:
            self._manual_deadline = now + MANUAL_OVERRIDE_S

    def release_manual(self, now: float) -> str | None:
        """The dev tab closed, or its renewal window lapsed on its own —
        hand control back to presence. If someone is already standing there
        (the developer was testing while real presence was active), re-enter
        the face/5s/gesture flow immediately rather than waiting for a fresh
        MQTT event that may never come. Returns the mode to apply, or None
        if already idle/nothing to do."""
        was_idle = self.mode == "idle"
        self.presence_driven = True
        self._manual_deadline = None
        if self._last_presence == "present":
            self.mode = "face"
            return "face"
        self.mode = "idle"
        return None if was_idle else "idle"

    def _manual_expired(self, now: float) -> bool:
        return (not self.presence_driven and self._manual_deadline is not None
                and now >= self._manual_deadline)

    # ---- presence-driven state machine -------------------------------- #
    def on_presence(self, payload: str, now: float) -> str | None:
        """payload is "present" or "absent" (radar/distance's GLOBAL_PRESENCE
        wire format). Returns the mode to apply, or None for no change."""
        if self._manual_expired(now):
            self.release_manual(now)

        self._last_presence = payload
        if not self.presence_driven:
            return None  # recorded, but the dev tab is driving right now

        if payload == "present":
            if self.mode != "idle":
                return None  # already face/gesture — a duplicate/debounced event
            self.mode = "face"
            return "face"

        # absent
        if self.mode == "idle":
            return None
        self.mode = "idle"
        return "idle"

    def on_face_timeout(self, now: float) -> str | None:
        """The 5s face window elapsed with no match. Caller fires this from
        a real wall-clock timer, since nothing else polls during the
        window."""
        if self._manual_expired(now):
            self.release_manual(now)
        if not self.presence_driven or self.mode != "face":
            return None  # stale timer from a mode/override we've since left
        self.mode = "gesture"
        return "gesture"

    def on_face_result(self, matched: bool, now: float) -> str | None:
        """A face frame was evaluated. `matched` is whether a known face was
        recognized (False just means "no match this frame", not "give up" —
        that's on_face_timeout's job). In manual/dev-tab mode a match never
        ends the session — the developer is watching it detect and wants
        the overlay to keep running."""
        if self._manual_expired(now):
            self.release_manual(now)
        if not matched:
            return None
        if not self.presence_driven:
            return None  # manual mode: publish the result, don't change mode
        if self.mode != "face":
            return None  # stale result from a frame queued before we left face
        self.mode = "idle"
        return "idle"
