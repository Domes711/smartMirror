import type { AppDispatch, RootState } from "./store";
import { mirrorActions } from "@/features/mirror/mirrorSlice";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { modulesActions } from "@/features/modules/modulesSlice";
import { profilesActions } from "@/features/profiles/profilesSlice";
import { setRuntimeCatalog } from "@/data/catalog";
import * as api from "@/services/api";
import type { LayoutStore } from "@/services/api";
import type { FacePhoto, Module, Profile, Regions, Scene, TimeWindow } from "@/types";

type Thunk<R = void> = (dispatch: AppDispatch, getState: () => RootState) => R;

export const userKeyOf = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, "_") || "default";
const pad = (n: number) => String(n).padStart(2, "0");

/* ---------- store catalog → app Module ---------- */
export function mapStoreModule(e: api.StoreModule, en: boolean): Module {
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
const isAllDay = (w: api.ApiWindow) => /^0\s+0\s/.test(w.from) && /^59\s+23\s/.test(w.to);

/* ---------- layout entries ⇄ regions ---------- */
function entriesToRegions(layout: api.LayoutEntry[]): Regions {
  const r: Regions = {};
  for (const e of layout || []) {
    const reg = api.posToRegion(e.position) as keyof Regions;
    (r[reg] = r[reg] || []).push(e.id);
  }
  return r;
}
function regionsToEntries(regions: Regions): api.LayoutEntry[] {
  const out: api.LayoutEntry[] = [];
  for (const reg of Object.keys(regions) as (keyof Regions)[]) {
    for (const id of regions[reg] || []) out.push({ id, position: api.regionToPos(reg as string) });
  }
  return out;
}

/* ---------- window → Scene ---------- */
function windowToScene(win: api.ApiWindow): Scene {
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
  const wins: Record<string, api.ApiWindow> = {};
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

  // every id referenced by a layout must have an instance, or PUT /layout 400s.
  const have = new Set((next.instances || []).map((i) => i.id));
  const referenced = new Set<string>();
  for (const u of Object.keys(next.windows)) for (const k of Object.keys(next.windows[u])) for (const e of next.windows[u][k].layout) referenced.add(e.id);
  for (const u of Object.keys(next.defaults)) for (const e of next.defaults[u]) referenced.add(e.id);
  next.instances = next.instances || [];
  for (const id of referenced) {
    if (!have.has(id)) next.instances.push({ id, type: id, values: {} });
  }
  return next;
}

/* ---------- bootstrap ---------- */
export const connectMirror = (): Thunk<Promise<void>> => async (dispatch, getState) => {
  const en = getState().ui.lang === "en";
  // 1. reachability
  try {
    const st = await api.mqttStatus().catch(() => api.health());
    dispatch(mirrorActions.setConnected(true));
    void st;
  } catch {
    dispatch(mirrorActions.setConnected(false));
    dispatch(mirrorActions.setError("offline"));
    return; // stay on seed mocks
  }

  // 2. store catalog (drives the runtime widget catalog + installed flags)
  try {
    const cat = await api.storeCatalog();
    const all = [...cat.own, ...cat.community];
    setRuntimeCatalog(all.map((e) => mapStoreModule(e, false)), all.map((e) => mapStoreModule(e, true)));
  } catch (e) {
    dispatch(mirrorActions.setError(String(e)));
  }

  // 3. module catalog + positions (for the editor)
  let instanceIds: string[] = [];
  try {
    const mods = await api.getModules();
    dispatch(mirrorActions.setModulesMeta({ positions: mods.positions, catalog: mods.catalog }));
    instanceIds = mods.registered_ids || [];
  } catch (e) {
    dispatch(mirrorActions.setError(String(e)));
  }

  // 4. layout store → scenes for the default profile. This is REQUIRED for the
  // scene editor to read/write; only go "live" once it loads, otherwise saves
  // would silently no-op against a null layout.
  let layout: LayoutStore | null = null;
  try {
    layout = await api.getLayout();
    dispatch(mirrorActions.setLayout(layout));
    const ids = new Set(instanceIds);
    (layout.instances || []).forEach((i) => ids.add(i.id));
    if (ids.size) dispatch(modulesActions.setInstalled([...ids]));
    dispatch(scenesActions.loadFromBackend(buildUserScenes(layout, "default", en)));
    dispatch(mirrorActions.setCurrentUserKey("default"));
    dispatch(mirrorActions.setLive(true));
  } catch (e) {
    dispatch(mirrorActions.setError("layout: " + String(e)));
    return; // stay on seed mocks; do not claim live
  }

  // 5. profiles
  try {
    const { profiles } = await api.listProfiles();
    const keys: Record<string, string> = {};
    const list: Profile[] = [];
    for (const p of profiles) {
      const key = p.builtin ? "default" : userKeyOf(p.name);
      keys[p.name] = key;
      if (!p.builtin) list.push({ id: key, name: p.name, photos: p.count, scenes: Object.keys(layout?.windows?.[key] || {}).length });
    }
    dispatch(mirrorActions.setProfileKeys(keys));
    dispatch(profilesActions.loadProfiles(list));
  } catch (e) {
    dispatch(mirrorActions.setError(String(e)));
  }
};

/** Re-fetch the store catalog (after install/uninstall) and refresh installed. */
export const refreshStoreData = (): Thunk<Promise<void>> => async (dispatch, getState) => {
  if (!getState().mirror.live) return;
  try {
    const cat = await api.storeCatalog();
    const all = [...cat.own, ...cat.community];
    setRuntimeCatalog(all.map((e) => mapStoreModule(e, false)), all.map((e) => mapStoreModule(e, true)));
    const mods = await api.getModules();
    const ids = new Set(mods.registered_ids || []);
    (getState().mirror.layout?.instances || []).forEach((i) => ids.add(i.id));
    dispatch(modulesActions.setInstalled([...ids]));
    // nudge a re-render of catalog-derived screens
    dispatch(mirrorActions.setModulesMeta({ positions: mods.positions, catalog: mods.catalog }));
  } catch (e) {
    dispatch(mirrorActions.setError(String(e)));
  }
};

/** Load one profile's windows into the scenes slice + its face photos. */
export const loadProfileLive = (name: string): Thunk<Promise<void>> => async (dispatch, getState) => {
  const m = getState().mirror;
  if (!m.live) return;
  const key = m.profileKeys[name] || userKeyOf(name);
  dispatch(mirrorActions.setCurrentUserKey(key));
  const en = getState().ui.lang === "en";
  if (m.layout) dispatch(scenesActions.loadFromBackend(buildUserScenes(m.layout, key, en)));
  try {
    const ds = await api.listDataset(name);
    const photos: FacePhoto[] = (ds.photos || []).map((file, i) => ({ id: file, file, n: i + 1, hue: (i * 47 + 18) % 360, src: api.photoUrl(name, file) }));
    dispatch(profilesActions.loadFacePhotos(photos));
  } catch {
    /* keep whatever is there */
  }
};
