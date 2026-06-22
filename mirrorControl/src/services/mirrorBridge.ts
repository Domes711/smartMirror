import type { store as Store } from "@/app/store";
import { connectMqtt, TOPICS } from "./mqtt";
import { devActions } from "@/features/dev/devSlice";

type AppStore = typeof Store;

/**
 * Subscribes to the broker and fans live mirror state into the Redux store.
 * Incoming MQTT is the source of truth for presence / radar targets / camera
 * recognition; everything also lands in the dev monitor log.
 */
export function startMirrorBridge(store: AppStore): void {
  connectMqtt({
    onConnect: () => store.dispatch(devActions.logMsg(line("←", "#3bd17a", "system", "mqtt connected"))),
    onClose: () => store.dispatch(devActions.logMsg(line("←", "#8C8C81", "system", "mqtt closed"))),
    onMessage: (topic, payload) => {
      // live monitor (dev → Komunikace)
      store.dispatch(devActions.logMsg(line("←", "#ffc34d", topic, payload)));

      try {
        if (topic === TOPICS.radarPresence) {
          store.dispatch(devActions.setPresence(payload.trim() === "present"));
        } else if (topic === TOPICS.radarTargets) {
          const data = JSON.parse(payload);
          const targets = Array.isArray(data) ? data : data.targets;
          if (Array.isArray(targets)) {
            store.dispatch(
              devActions.setLiveTargets(
                targets.map((t: { x: number; y: number; speed?: number }) => ({ x: t.x, y: t.y, speed: t.speed }))
              )
            );
          }
        }
      } catch {
        /* non-JSON payloads (presence strings etc.) are fine */
      }
    },
  });
}

function line(dir: "→" | "←", dirColor: string, topic: string, payload: string) {
  const d = new Date();
  const t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  return { t, dir, dirColor, topic, payload: payload.slice(0, 120) };
}
