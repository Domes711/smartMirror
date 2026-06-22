import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RegionId, Scene, SelChip, Regions, TimeWindow } from "@/types";
import { resolveActiveId } from "@/app/selectors";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export interface ScenesState {
  scenes: Record<string, Scene>;
  activeScene: string;
  live: Regions | null;
  dirty: number;
  editing: string | null;
  editReturn: string;
  editSnap: string;
  picked: string | null;
  selChip: SelChip | null;
  palRemove: string | null;
  zoneOpen: RegionId | null;
  // new-scene modal
  newSceneModal: boolean;
  nsName: string;
  nsStart: number;
  nsEnd: number;
  nsNoSlot: boolean;
  sceneSeq: number;
  // time-edit modal
  timeEditOpen: boolean;
  teStart: number;
  teEnd: number;
  // confirmations
  delModal: boolean;
  editBackModal: boolean;
  // schedule windows
  windows: TimeWindow[];
  winSeq: number;
}

const seedScenes: Record<string, Scene> = {
  day: { name: "Denní", name_en: "Daytime", use: "default · 10:00–18:00", use_en: "default · 10:00–18:00", startH: 10, endH: 18, startLabel: "10:00", endLabel: "18:00", scheduled: true, regions: { top_left: ["clock"], top_right: ["MMM-Brno-Transit"], bottom_center: ["MMM-Flights"], middle: ["MMM-Mail", "MMM-Calendar", "MMM-Weather", "MMM-HA-Reminders"] } },
  morning: { name: "Ranní", name_en: "Morning", use: "Eliška · po–pá 06:00–10:00", use_en: "Eliška · Mon–Fri 06:00–10:00", startH: 6, endH: 10, startLabel: "06:00", endLabel: "10:00", scheduled: true, regions: { top_left: ["clock"], top_right: ["MMM-Brno-Transit"], middle: ["MMM-Mail"] } },
  evening: { name: "Večerní", name_en: "Evening", use: "nepoužito", use_en: "unused", startH: 18, endH: 23, startLabel: "18:00", endLabel: "23:00", scheduled: false, regions: { top_center: ["clock"], lower_third: ["MMM-Package-Tracker"] } },
};

const initialState: ScenesState = {
  scenes: seedScenes,
  activeScene: "day",
  live: null,
  dirty: 0,
  editing: null,
  editReturn: "scenes",
  editSnap: "{}",
  picked: null,
  selChip: null,
  palRemove: null,
  zoneOpen: null,
  newSceneModal: false,
  nsName: "",
  nsStart: 8,
  nsEnd: 18,
  nsNoSlot: false,
  sceneSeq: 0,
  timeEditOpen: false,
  teStart: 8,
  teEnd: 18,
  delModal: false,
  editBackModal: false,
  windows: [{ time: "10:00–18:00", scene: "day" }],
  winSeq: 1,
};

const scenesSlice = createSlice({
  name: "scenes",
  initialState,
  reducers: {
    /** Replace the scene set from the live mirror (per-profile windows). */
    loadFromBackend(s, a: PayloadAction<{ scenes: Record<string, Scene>; activeScene: string; windows: TimeWindow[] }>) {
      s.scenes = a.payload.scenes;
      s.activeScene = a.payload.activeScene;
      s.windows = a.payload.windows;
      s.live = clone(s.scenes[s.activeScene]?.regions ?? {});
      s.editing = null;
      s.picked = null;
      s.selChip = null;
    },
    /** Snapshot current activeScene regions into `live`. */
    syncLiveFromActive(s) {
      s.live = clone(s.scenes[s.activeScene].regions);
    },
    applyLive(s) {
      // snapshot what the mirror should show right now (time-resolved)
      s.activeScene = resolveActiveId(s.scenes) || s.activeScene;
      s.live = clone(s.scenes[s.activeScene]?.regions ?? {});
      s.dirty = 0;
    },
    setActiveScene(s, a: PayloadAction<string>) {
      s.activeScene = a.payload;
    },

    // --- editor session ---
    startEdit(s, a: PayloadAction<{ id: string; editReturn: string }>) {
      s.editing = a.payload.id;
      s.editReturn = a.payload.editReturn;
      s.picked = null;
      s.selChip = null;
      s.palRemove = null;
      s.editBackModal = false;
      s.editSnap = JSON.stringify(s.scenes[a.payload.id]?.regions ?? {});
    },
    stopEdit(s) {
      s.editing = null;
      s.zoneOpen = null;
      s.picked = null;
      s.selChip = null;
      s.palRemove = null;
    },
    setSceneName(s, a: PayloadAction<string>) {
      if (!s.editing) return;
      const sc = s.scenes[s.editing];
      if (sc) {
        sc.name = a.payload;
        sc.name_en = a.payload;
      }
      s.dirty += 1;
    },

    // --- palette / held / selected ---
    pickPalette(s, a: PayloadAction<string>) {
      s.picked = s.picked === a.payload ? null : a.payload;
      s.selChip = null;
      s.palRemove = null;
    },
    armPaletteRemove(s, a: PayloadAction<string>) {
      const m = a.payload;
      if (s.palRemove === m) {
        s.palRemove = null;
        s.selChip = null;
        return;
      }
      const rg = (s.editing && s.scenes[s.editing]?.regions) || {};
      const region = (Object.keys(rg) as RegionId[]).find((rid) => (rg[rid] || []).includes(m)) || null;
      s.palRemove = m;
      s.picked = null;
      s.selChip = region ? { region, mod: m } : null;
    },
    clearHeld(s) {
      s.picked = null;
      s.selChip = null;
      s.palRemove = null;
    },
    selectChip(s, a: PayloadAction<SelChip>) {
      const cur = s.selChip;
      if (cur && cur.region === a.payload.region && cur.mod === a.payload.mod) {
        s.selChip = null;
      } else {
        s.selChip = a.payload;
        s.picked = null;
      }
    },

    // --- region operations (return a status string consumers can toast) ---
    /** regionPlus result: 'added' | 'moved' | 'select'. */
    placeAt(s, a: PayloadAction<RegionId>) {
      const rid = a.payload;
      if (!s.editing) return;
      const reg = s.scenes[s.editing].regions;
      if (s.picked) {
        reg[rid] = reg[rid] || [];
        if (!reg[rid]!.includes(s.picked)) reg[rid]!.push(s.picked);
        s.picked = null;
        s.dirty += 1;
      } else if (s.selChip) {
        const from = reg[s.selChip.region];
        if (from) {
          const i = from.indexOf(s.selChip.mod);
          if (i > -1) from.splice(i, 1);
          if (!from.length) delete reg[s.selChip.region];
        }
        reg[rid] = reg[rid] || [];
        reg[rid]!.push(s.selChip.mod);
        s.selChip = null;
        s.palRemove = null;
        s.dirty += 1;
      }
    },
    addModToZone(s, a: PayloadAction<{ rid: RegionId; mod: string }>) {
      if (!s.editing) return;
      const reg = s.scenes[s.editing].regions;
      reg[a.payload.rid] = reg[a.payload.rid] || [];
      if (reg[a.payload.rid]!.includes(a.payload.mod)) return;
      reg[a.payload.rid]!.push(a.payload.mod);
      s.dirty += 1;
    },
    moveModInZone(s, a: PayloadAction<{ rid: RegionId; idx: number; dir: number }>) {
      if (!s.editing) return;
      const arr = s.scenes[s.editing].regions[a.payload.rid];
      const j = a.payload.idx + a.payload.dir;
      if (!arr || j < 0 || j >= arr.length) return;
      [arr[a.payload.idx], arr[j]] = [arr[j], arr[a.payload.idx]];
      s.dirty += 1;
    },
    removeMod(s, a: PayloadAction<{ rid: RegionId; mod: string }>) {
      if (!s.editing) return;
      const reg = s.scenes[s.editing].regions;
      const arr = reg[a.payload.rid];
      if (!arr) return;
      const i = arr.indexOf(a.payload.mod);
      if (i > -1) {
        arr.splice(i, 1);
        if (!arr.length) delete reg[a.payload.rid];
        s.dirty += 1;
      }
    },
    removeModFromScene(s, a: PayloadAction<string>) {
      if (!s.editing) return;
      const reg = s.scenes[s.editing].regions;
      for (const rid of Object.keys(reg) as RegionId[]) {
        reg[rid] = (reg[rid] || []).filter((x) => x !== a.payload);
        if (!reg[rid]!.length) delete reg[rid];
      }
      s.palRemove = null;
    },

    // --- zone bottom sheet ---
    openZone(s, a: PayloadAction<RegionId>) {
      s.zoneOpen = a.payload;
      s.picked = null;
      s.selChip = null;
    },
    closeZone(s) {
      s.zoneOpen = null;
    },

    // --- new-scene modal ---
    openNewScene(s, a: PayloadAction<{ name: string; start: number; end: number; noSlot: boolean }>) {
      s.newSceneModal = true;
      s.nsName = a.payload.name;
      s.nsStart = a.payload.start;
      s.nsEnd = a.payload.end;
      s.nsNoSlot = a.payload.noSlot;
    },
    closeNewScene(s) {
      s.newSceneModal = false;
    },
    setNsName(s, a: PayloadAction<string>) {
      s.nsName = a.payload;
    },
    setNsStart(s, a: PayloadAction<number>) {
      s.nsStart = a.payload;
    },
    setNsEnd(s, a: PayloadAction<number>) {
      s.nsEnd = a.payload;
    },
    setNsRange(s, a: PayloadAction<{ start: number; end: number }>) {
      s.nsStart = a.payload.start;
      s.nsEnd = a.payload.end;
    },
    /** Insert a fresh scene; caller passes the generated id. */
    insertScene(s, a: PayloadAction<{ id: string; scene: Scene; bumpSeq?: boolean }>) {
      s.scenes[a.payload.id] = a.payload.scene;
      if (a.payload.bumpSeq) s.sceneSeq += 1;
      s.newSceneModal = false;
    },

    // --- time-edit modal ---
    openTimeEdit(s) {
      const sc = (s.editing && s.scenes[s.editing]) || null;
      s.timeEditOpen = true;
      s.teStart = sc?.startH ?? 8;
      s.teEnd = sc?.endH ?? 18;
    },
    closeTimeEdit(s) {
      s.timeEditOpen = false;
    },
    setTeStart(s, a: PayloadAction<number>) {
      s.teStart = a.payload;
    },
    setTeEnd(s, a: PayloadAction<number>) {
      s.teEnd = a.payload;
    },
    saveTimeEdit(s) {
      if (s.teEnd <= s.teStart || !s.editing) return;
      const sc = s.scenes[s.editing];
      if (sc) {
        sc.startH = s.teStart;
        sc.endH = s.teEnd;
        sc.startLabel = String(s.teStart).padStart(2, "0") + ":00";
        sc.endLabel = String(s.teEnd).padStart(2, "0") + ":00";
        sc.allDay = false;
        sc.scheduled = true;
      }
      s.timeEditOpen = false;
      s.dirty += 1;
    },

    // --- delete-scene confirm ---
    openDelModal(s) {
      s.delModal = true;
    },
    closeDelModal(s) {
      s.delModal = false;
    },
    confirmDelScene(s) {
      const id = s.editing;
      if (id && s.scenes[id] && Object.keys(s.scenes).length > 1) {
        delete s.scenes[id];
        if (s.activeScene === id) s.activeScene = Object.keys(s.scenes)[0];
      }
      s.delModal = false;
      s.editing = null;
      s.zoneOpen = null;
      s.picked = null;
      s.selChip = null;
    },

    // --- unsaved-changes (editor back) ---
    openEditBack(s) {
      s.editBackModal = true;
    },
    closeEditBack(s) {
      s.editBackModal = false;
    },
    discardEdit(s) {
      if (s.editing && s.scenes[s.editing]) {
        s.scenes[s.editing].regions = JSON.parse(s.editSnap);
      }
      s.editBackModal = false;
    },

    // --- windows ---
    addWindowScene(s, a: PayloadAction<{ id: string; scene: Scene; window: TimeWindow; seq: number }>) {
      s.scenes[a.payload.id] = a.payload.scene;
      s.windows.push(a.payload.window);
      s.winSeq = a.payload.seq;
    },

    /** Remove a widget id everywhere when its module is deleted. */
    purgeModule(s, a: PayloadAction<string>) {
      for (const sid of Object.keys(s.scenes)) {
        const reg = s.scenes[sid].regions;
        for (const rid of Object.keys(reg) as RegionId[]) {
          reg[rid] = (reg[rid] || []).filter((x) => x !== a.payload);
          if (!reg[rid]!.length) delete reg[rid];
        }
      }
    },
  },
});

export const scenesActions = scenesSlice.actions;
export default scenesSlice.reducer;
