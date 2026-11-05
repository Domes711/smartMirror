import { useEffect, useRef, useState } from "react";

// Must be well under the daemons' STREAM_TIMEOUT_S (6s — radar/daemon.py,
// distance/constants.py) so a renewal always lands before the lease expires.
const RENEW_MS = 2000;

/**
 * Opt-in live sensor stream for the dev console ("Začít měřit").
 *
 * Always starts OFF — the state is local to the mounted screen, never
 * persisted, so every visit to the tab begins with nothing on the broker.
 * While ON it sends `send(true)` immediately and renews every RENEW_MS.
 * It turns OFF — sending `send(false)` right away — when:
 *   - the user flips the switch off,
 *   - the screen unmounts (leaving the tab, leaving dev mode),
 *   - the page is hidden (app backgrounded, phone locked, tab switched),
 *   - the page is closed/reloaded (pagehide).
 * If none of those get the chance to run (app killed, Wi-Fi gone), the
 * daemon's lease expires on its own after STREAM_TIMEOUT_S.
 */
export function useLiveStream(send: (active: boolean) => void, onStop?: () => void): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  const sendRef = useRef(send);
  const stopRef = useRef(onStop);
  sendRef.current = send;
  stopRef.current = onStop;

  useEffect(() => {
    if (!on) return;
    sendRef.current(true);
    const renew = setInterval(() => sendRef.current(true), RENEW_MS);

    const kill = () => {
      sendRef.current(false);
      setOn(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") kill();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", kill);

    return () => {
      clearInterval(renew);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", kill);
      sendRef.current(false);
      stopRef.current?.();
    };
  }, [on]);

  return [on, setOn];
}
