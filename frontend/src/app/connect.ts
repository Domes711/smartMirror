import type { ApiWindow, LayoutEntry, LayoutStore } from "@/app/api/scenesApi";
import { posToRegion, regionToPos } from "@/app/api/scenesApi";
import type { StoreModule } from "@/app/api/modulesApi";
import type { Module, Regions, Scene, TimeWindow } from "@/types";

export const userKeyOf = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, "_") || "default";
const pad = (n: number) => String(n).padStart(2, "0");

/* ---------- store catalog → app Module ---------- */
export function mapStoreModule(e: StoreModule, en: boolean): Module {
  const lang = en ? "en" : "cs";
  const c = e.catalog?.name?.[lang] || e.name;
  const d = e.catalog?.description?.[lang] || e.description || "";
  const t = e.catalog?.tags?.length ? e.catalog.tags : e.category ? [e.category] : [];
  const img = e.image || e.images?.[0] || e.catalog?.screenshots?.[0] || undefined;
  return { n: e.id, c, d, t, own: e.own, installed: e.installed, url: e.url || undefined, img, mini: [c.slice(0, 10).toUpperCase()] };
}

/* ---------- cron ⇄ hours ---------- */
function cronHM(cron: string): { h: number; m: number } {
  const p = (cron || "").trim().split(/\s+/);
  return { m: parseInt(p[0], 10) || 0, h: parseInt(p[1], 10) || 0 };
}
const isAllDay = (w: ApiWindow) => /^0\s+0\s/.test(w.from) && /^59\s+23\s/.test(w.to);

/* ---------- layout entries ⇄ regions ---------- */
function entriesToRegions(layout: LayoutEntry[]): Regions {
  const r: Regions = {};
  for (const e of layout || []) {
    const reg = posToRegion(e.position) as keyof Regions;
    (r[reg] = r[reg] || []).push(e.id);
  }
  return r;
}
export function regionsToEntries(regions: Regions): LayoutEntry[] {
  const out: LayoutEntry[] = [];
  for (const reg of Object.keys(regions) as (keyof Regions)[]) {
    for (const id of regions[reg] || []) out.push({ id, position: regionToPos(reg as string) });
  }
  return out;
}

/* ---------- window → Scene ---------- */
function windowToScene(win: ApiWindow): Scene {
  const a = cronHM(win.from);
  const b = cronHM(win.to);
  const startH = a.h;
  const endH = b.m >= 59 ? b.h + 1 : b.h; // console stores to as HH:59
  const startLabel = `${pad(a.h)}:${pad(a.m)}`;
  const endLabel = `${pad(endH % 24)}:00`;
  const allDay = isAllDay(win);
  const name = win.label || `${startLabel}–${endLabel}`;
  return { name, name_en: name, use: win.label || "", use_en: win.label || "", startH, endH, startLabel, endLabel, scheduled: !allDay, allDay, regions: entriesToRegions(win.layout) };
}

/** Build the scenes slice payload for one profile's windows + default. */
export function buildUserScenes(store: LayoutStore, userKey: string, en: boolean): { scenes: Record<string, Scene>; activeScene: string; windows: TimeWindow[] } {
  const scenes: Record<string, Scene> = {};
  const windows: TimeWindow[] = [];
  const wins = store.windows?.[userKey] || {};
  for (const key of Object.keys(wins)) {
    const id = `${userKey}:${key}`;
    const sc = windowToScene(wins[key]);
    scenes[id] = sc;
    windows.push({ time: `${sc.startLabel}–${sc.endLabel}`, scene: id });
  }
  const def = store.defaults?.[userKey];
  if (def && def.length) {
    scenes["__default__"] = { name: en ? "Default" : "Výchozí", name_en: "Default", use: "default", use_en: "default", startLabel: "", endLabel: "", scheduled: false, allDay: false, regions: entriesToRegions(def) };
  }
  if (!Object.keys(scenes).length) {
    scenes["__default__"] = { name: en ? "Default" : "Výchozí", name_en: "Default", use: "default", use_en: "default", startLabel: "", endLabel: "", scheduled: false, allDay: false, regions: {} };
  }
  // active = scheduled window covering now, else default
  const now = new Date().getHours() + new Date().getMinutes() / 60;
  const active =
    Object.keys(scenes).find((id) => {
      const s = scenes[id];
      return s.scheduled && s.startH != null && s.endH != null && now >= s.startH && now < s.endH;
    }) || (scenes["__default__"] ? "__default__" : Object.keys(scenes)[0]);
  return { scenes, activeScene: active, windows };
}

/** Serialize the current scenes slice back into the layout store for a user. */
export function scenesToStore(store: LayoutStore, userKey: string, scenes: Record<string, Scene>): LayoutStore {
  const next: LayoutStore = JSON.parse(JSON.stringify(store));
  const wins: Record<string, ApiWindow> = {};
  for (const id of Object.keys(scenes)) {
    if (id === "__default__") {
      next.defaults[userKey] = regionsToEntries(scenes[id].regions);
      continue;
    }
    const sc = scenes[id];
    const key = id.includes(":") ? id.split(":").slice(1).join(":") : id;
    if (sc.allDay) {
      // preserve all-day windows (e.g. the backend's default window)
      wins[key] = { from: "0 0 * * *", to: "59 23 * * *", label: sc.name || (sc.use || "all_day"), layout: regionsToEntries(sc.regions) };
      continue;
    }
    if (!sc.scheduled || sc.startH == null || sc.endH == null) continue;
    const toH = (sc.endH - 1 + 24) % 24;
    wins[key] = {
      from: `0 ${sc.startH} * * *`,
      to: `59 ${toH} * * *`,
      label: sc.name || `${sc.startLabel}–${sc.endLabel}`,
      layout: regionsToEntries(sc.regions),
    };
  }
  next.windows[userKey] = wins;
  // NOTE: we never synthesize instances here. Layout entries may reference any
  // existing module id (config.js managed entries + console instances); the
  // backend doesn't require them in `instances`, and creating one would inject
  // a duplicate module into config.js (two clocks in the same spot).
  return next;
}
