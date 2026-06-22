// Domain & UI types — derived from the prototype state (§6) and data models (§9).

export type Lang = "cs" | "en";

export type ScreenId =
  | "home"
  | "windows"
  | "scenes"
  | "editor"
  | "modules"
  | "moddetail"
  | "create"
  | "workshop"
  | "profiles"
  | "profile"
  | "addphotos"
  | "newprofile"
  | "settings"
  | "radar"
  | "camera"
  | "comms";

/** Bottom-nav groups. The four main tabs + dev tabs + settings (hides nav). */
export type TabGroup =
  | "home"
  | "scenes"
  | "modules"
  | "profiles"
  | "radar"
  | "camera"
  | "comms"
  | "settings";

export type RegionId =
  | "top_bar"
  | "top_left"
  | "top_center"
  | "top_right"
  | "upper_third"
  | "middle"
  | "lower_third"
  | "bottom_left"
  | "bottom_center"
  | "bottom_right"
  | "bottom_bar";

export interface RegionDef {
  id: RegionId;
  label: string; // EN
  cs: string; // CS
  full?: boolean; // spans all three columns
  j?: "flex-start" | "center" | "flex-end"; // justify of widgets within
}

/** A widget's placement: region id -> ordered widget ids. */
export type Regions = Partial<Record<RegionId, string[]>>;

export interface Scene {
  name: string;
  name_en: string;
  use: string;
  use_en: string;
  startH?: number;
  endH?: number;
  startLabel: string;
  endLabel: string;
  scheduled: boolean;
  allDay?: boolean;
  regions: Regions;
}

/** Catalog module. `n` is the canonical MagicMirror id, `c`/`d` localized. */
export interface Module {
  n: string;
  c: string;
  d: string;
  t: string[];
  own?: boolean;
  mini: string[];
  /** Real store thumbnail/screenshot URL (when connected to a live mirror). */
  img?: string;
  /** Real store repo URL (for the README fetch). */
  url?: string;
  installed?: boolean;
}

/** Work-in-progress AI widget. c/ce + d/de carry CS/EN variants. */
export interface Draft {
  n: string;
  c: string;
  ce: string;
  d: string;
  de: string;
  t: string[];
  te: string[];
  mini: string[];
}

export interface Profile {
  id: string;
  name: string;
  photos: number;
  scenes: number;
}

export interface FacePhoto {
  id: string;
  hue: number;
  n: number;
  /** Real photo URL + backend filename (when connected to a live mirror). */
  src?: string;
  file?: string;
}

export type ChatRole = "me" | "bot";
export interface ChatMsg {
  role: ChatRole;
  text: string;
  kind?: "ctrl" | "status";
}

/** One line in the dev MQTT monitor. */
export interface MqttMsg {
  t: string; // HH:MM:SS
  dir: "→" | "←";
  dirColor: string;
  topic: string;
  payload: string;
}

export interface TimeWindow {
  time: string; // "HH:MM–HH:MM"
  scene: string; // scene id
}

export type ConnState = "idle" | "scanning" | "found";
export type TaskKind = "retrain" | "install" | null;
export type CtrlType = "toggle" | "select" | "slider";

/** Currently selected chip on the editor canvas. */
export interface SelChip {
  region: RegionId;
  mod: string;
}
