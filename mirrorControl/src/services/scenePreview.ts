import type { store as Store } from "@/app/store";
import { publish, TOPICS } from "@/services/mqtt";
import { mqttPublish } from "@/services/api";
import { regionsToEntries } from "@/app/connect";

type AppStore = typeof Store;

/**
 * Live "scene setup" preview: while a scene is open in the editor, project it
 * onto the real mirror and flip the Face ID indicator into editing mode
 * (scene name + time). Leaving the editor restores the live state.
 * Published over MQTT WS (low latency) and the backend bridge (reliable).
 */
export function startScenePreview(store: AppStore): void {
  let lastKey = "";
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (payload: unknown) => {
    publish(TOPICS.profilePreview, payload);
    mqttPublish(TOPICS.profilePreview, payload).catch(() => {});
  };

  store.subscribe(() => {
    const s = store.getState();
    if (!s.mirror.live) return;
    const inEditor = s.ui.screen === "editor" && s.scenes.editing;

    if (inEditor) {
      const sc = s.scenes.scenes[s.scenes.editing as string];
      if (!sc) return;
      const en = s.ui.lang === "en";
      const time = sc.allDay
        ? en ? "all day" : "celý den"
        : sc.scheduled && sc.startLabel && sc.endLabel
          ? `${sc.startLabel}–${sc.endLabel}`
          : en ? "default" : "výchozí";
      const name = (en && sc.name_en ? sc.name_en : sc.name) || "";
      const key = JSON.stringify(sc.regions) + "|" + name + "|" + time;
      if (key === lastKey) return;
      lastKey = key;
      active = true;
      const layout = regionsToEntries(sc.regions);
      const scene = { name, time, eyebrow: en ? "EDITING SCENE" : "ŘEŠÍM SCÉNU" };
      clearTimeout(timer);
      timer = setTimeout(() => send({ layout, scene }), 120);
    } else if (active) {
      // left the editor → restore the mirror's live state
      active = false;
      lastKey = "";
      clearTimeout(timer);
      send({ exit: true });
    }
  });
}
