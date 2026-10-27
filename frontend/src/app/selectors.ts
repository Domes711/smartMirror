import type { Scene } from "@/types";

/** Current hour-of-day as a float (e.g. 12.68 for 12:41). */
export function nowHours(): number {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

const isDefaultScene = (id: string, s: Scene) => id === "__default__" || /^default/i.test(s.use || "");

/**
 * Resolve which scene is "active" right now: the scheduled window covering the
 * current time (latest start wins on overlap), else the per-profile default /
 * all-day scene, else the first scene. This is what the mirror would show.
 */
export function resolveActiveId(scenes: Record<string, Scene>, nowH = nowHours()): string {
  const ids = Object.keys(scenes);
  if (!ids.length) return "";
  const scheduled = ids.filter((id) => {
    const s = scenes[id];
    return s.scheduled && !s.allDay && s.startH != null && s.endH != null && nowH >= s.startH && nowH < s.endH;
  });
  if (scheduled.length) return scheduled.sort((a, b) => (scenes[b].startH as number) - (scenes[a].startH as number))[0];
  const def = ids.find((id) => isDefaultScene(id, scenes[id])) || ids.find((id) => scenes[id].allDay);
  return def || ids[0];
}
