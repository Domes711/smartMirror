import type { Module, RegionDef } from "@/types";

/** MagicMirror regions in the canonical 3-column grid order. */
export const REGIONS: RegionDef[] = [
  { id: "top_bar", label: "Top bar", cs: "Horní lišta", full: true },
  { id: "top_left", label: "Top left", cs: "Vlevo nahoře", j: "flex-start" },
  { id: "top_center", label: "Top center", cs: "Nahoře uprostřed", j: "center" },
  { id: "top_right", label: "Top right", cs: "Vpravo nahoře", j: "flex-end" },
  { id: "upper_third", label: "Upper third", cs: "Horní třetina", full: true },
  { id: "middle", label: "Middle", cs: "Uprostřed", full: true, j: "center" },
  { id: "lower_third", label: "Lower third", cs: "Dolní třetina", full: true },
  { id: "bottom_left", label: "Bottom left", cs: "Vlevo dole", j: "flex-start" },
  { id: "bottom_center", label: "Bottom center", cs: "Dole uprostřed", j: "center" },
  { id: "bottom_right", label: "Bottom right", cs: "Vpravo dole", j: "flex-end" },
  { id: "bottom_bar", label: "Bottom bar", cs: "Dolní lišta", full: true },
];

/** Runtime catalog injected from the live mirror (/store/catalog). When set,
 * STORE()/fmod() transparently return real data so screens need no changes. */
let RUNTIME: { cs: Module[]; en: Module[] } | null = null;
export function setRuntimeCatalog(cs: Module[] | null, en: Module[] | null): void {
  RUNTIME = cs && en ? { cs, en } : null;
}
export function hasRuntimeCatalog(): boolean {
  return RUNTIME !== null;
}

/** The widget catalog. Localized by `en`. Comes only from the live mirror
 * (/store/catalog) — no local fallback, so an unreachable backend means an
 * empty catalog rather than fabricated widgets. */
export function STORE(en: boolean): Module[] {
  if (RUNTIME) return en ? RUNTIME.en : RUNTIME.cs;
  return [];
}

export interface CatDef {
  tag: string;
  cs: string;
  en: string;
}

export const CATEGORIES: CatDef[] = [
  { tag: "productivity", cs: "Produktivita", en: "Productivity" },
  { tag: "weather", cs: "Počasí", en: "Weather" },
  { tag: "transit", cs: "Doprava", en: "Transit" },
  { tag: "finance", cs: "Finance", en: "Finance" },
  { tag: "travel", cs: "Cestování", en: "Travel" },
  { tag: "media", cs: "Média", en: "Media" },
  { tag: "health", cs: "Zdraví", en: "Health" },
  { tag: "sports", cs: "Sport", en: "Sports" },
  { tag: "calendar", cs: "Kalendář", en: "Calendar" },
  { tag: "email", cs: "E-mail", en: "Email" },
];

/** Localized display name for a widget id (falls back to the id). */
export function fmod(id: string, en: boolean): string {
  if (!id) return id;
  const m = STORE(en).find((x) => x.n === id);
  return m ? m.c : id;
}
