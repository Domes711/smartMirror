import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Lang, ScreenId, TabGroup, TaskKind } from "@/types";

/** groupOf — which bottom-nav tab a screen highlights. */
export const groupOf = (id: ScreenId): TabGroup | null =>
  (
    {
      home: "home", windows: "home",
      scenes: "scenes", editor: "scenes",
      modules: "modules", moddetail: "modules", create: "modules", workshop: "modules",
      profiles: "profiles", profile: "profiles", addphotos: "profiles", newprofile: "profiles",
      radar: "radar", camera: "camera", comms: "comms",
    } as Record<ScreenId, TabGroup>
  )[id] ?? null;

const MAIN_TABS: TabGroup[] = ["home", "scenes", "modules", "profiles"];

export interface UiState {
  lang: Lang;
  screen: ScreenId;
  tab: TabGroup;
  lastTab: TabGroup;
  lastTabScreen: ScreenId;
  tabScreens: Record<"home" | "scenes" | "modules" | "profiles", ScreenId>;
  settingsReturn: ScreenId;
  settingsReturnTab: TabGroup;
  time: string;
  toast: string;
  homeLoading: boolean;
  // global async task (install / retrain / train)
  taskActive: boolean;
  taskPct: number;
  taskLabel: string;
  taskKind: TaskKind;
  taskTarget: string | null;
  // AI agent (workshop)
  agentBusy: boolean;
  agentReady: boolean;
  agentStatus: string;
  agentMod: string;
}

const initialState: UiState = {
  lang: "cs",
  screen: "home",
  tab: "home",
  lastTab: "home",
  lastTabScreen: "home",
  tabScreens: { home: "home", scenes: "scenes", modules: "modules", profiles: "profiles" },
  settingsReturn: "home",
  settingsReturnTab: "home",
  time: "14:22",
  toast: "",
  homeLoading: true,
  taskActive: false,
  taskPct: 0,
  taskLabel: "",
  taskKind: null,
  taskTarget: null,
  agentBusy: false,
  agentReady: false,
  agentStatus: "",
  agentMod: "",
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setLang(s, a: PayloadAction<Lang>) {
      s.lang = a.payload;
    },
    /** Core navigation. Mirrors prototype nav(screen, tab). */
    navTo(s, a: PayloadAction<{ screen: ScreenId; tab?: TabGroup | null }>) {
      const { screen } = a.payload;
      s.screen = screen;
      if (screen === "workshop") s.agentReady = false;
      const g = a.payload.tab ?? groupOf(screen);
      if (a.payload.tab) {
        s.lastTab = a.payload.tab;
        s.lastTabScreen = screen;
      }
      if (g) s.tab = g;
      if (g && g !== "settings" && MAIN_TABS.includes(g)) {
        s.tabScreens[g as "home" | "scenes" | "modules" | "profiles"] = screen;
      }
    },
    /** goTab — switch tabs, remembering each tab's last screen. */
    goTab(s, a: PayloadAction<TabGroup>) {
      const g = a.payload;
      const curG = groupOf(s.screen);
      if (curG && MAIN_TABS.includes(curG) && curG !== g) {
        s.tabScreens[curG as "home" | "scenes" | "modules" | "profiles"] = s.screen;
      }
      const dest =
        curG === g
          ? (g as ScreenId)
          : (s.tabScreens[g as "home" | "scenes" | "modules" | "profiles"] ?? (g as ScreenId));
      s.screen = dest;
      s.tab = g;
    },
    openSettings(s) {
      if (s.screen === "settings") {
        s.screen = s.settingsReturn;
        s.tab = s.settingsReturnTab;
        return;
      }
      s.settingsReturn = s.screen;
      s.settingsReturnTab = s.tab;
      s.screen = "settings";
      s.tab = "settings";
    },
    closeSettings(s) {
      s.screen = s.settingsReturn;
      s.tab = s.settingsReturnTab;
    },
    setScreenTab(s, a: PayloadAction<{ screen: ScreenId; tab: TabGroup }>) {
      s.screen = a.payload.screen;
      s.tab = a.payload.tab;
    },
    setTime(s, a: PayloadAction<string>) {
      s.time = a.payload;
    },
    setToast(s, a: PayloadAction<string>) {
      s.toast = a.payload;
    },
    setHomeLoading(s, a: PayloadAction<boolean>) {
      s.homeLoading = a.payload;
    },
    // --- task bar ---
    taskStart(s, a: PayloadAction<{ label: string; kind: TaskKind; target: string | null }>) {
      s.taskActive = true;
      s.taskPct = 0;
      s.taskLabel = a.payload.label;
      s.taskKind = a.payload.kind;
      s.taskTarget = a.payload.target;
    },
    taskProgress(s, a: PayloadAction<number>) {
      s.taskPct = a.payload;
    },
    taskClear(s) {
      s.taskActive = false;
      s.taskPct = 0;
      s.taskLabel = "";
      s.taskKind = null;
      s.taskTarget = null;
    },
    // --- agent bar ---
    agentStart(s, a: PayloadAction<{ status: string; mod: string }>) {
      s.agentBusy = true;
      s.agentReady = false;
      s.agentStatus = a.payload.status;
      s.agentMod = a.payload.mod;
    },
    agentStatus(s, a: PayloadAction<string>) {
      s.agentStatus = a.payload;
    },
    agentDone(s, a: PayloadAction<{ ready: boolean }>) {
      s.agentBusy = false;
      s.agentReady = a.payload.ready;
    },
    agentClearReady(s) {
      s.agentReady = false;
    },
  },
});

export const uiActions = uiSlice.actions;
export default uiSlice.reducer;
