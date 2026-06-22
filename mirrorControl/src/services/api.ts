// Real mirror-console backend client. All paths are same-origin (served from
// the Pi in prod; proxied to :8000 in dev — see vite.config.ts). Shapes match
// mirror-console/server/index.js + backend/supervisor.py.

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method || "GET"} ${path} → ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : (res.text() as unknown)) as Promise<T>;
}
const jpost = (p: string, body?: unknown) => req(p, { method: "POST", body: JSON.stringify(body ?? {}) });

/* ---------- system ---------- */
export interface MqttStatus { connected: boolean; url: string }
export const mqttStatus = () => req<MqttStatus>("/api/mqtt/status");
export const health = () => req<{ mode: string; modes: string[]; camera_open: boolean; daemon_active: boolean; fps: number; width: number; height: number }>("/healthz");

/* ---------- camera / dataset ---------- */
export const streamUrl = () => "/stream.mjpg";
export const photoUrl = (name: string, file: string) => `/photo?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`;
export const getMode = () => req<{ mode: string }>("/mode");
export const setMode = (mode: string) => jpost("/mode", { mode });
export const listDataset = (name: string) => req<{ name: string; photos: string[] }>(`/dataset?name=${encodeURIComponent(name)}`);
export const capture = (name: string, file?: string) => jpost("/capture", { name, file }) as Promise<{ file: string; total: number }>;
export const deletePhoto = (name: string, file: string) => req<{ ok: boolean; photos: string[] }>(`/dataset?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`, { method: "DELETE" });

/* ---------- profiles ---------- */
export interface ApiProfile { name: string; count: number; sample: string | null; builtin: boolean }
export const listProfiles = () => req<{ profiles: ApiProfile[] }>("/profiles");
export const deleteProfile = (name: string) => req<{ removed: string; profiles: ApiProfile[] }>(`/profiles?name=${encodeURIComponent(name)}`, { method: "DELETE" });
export const encode = (name?: string | null) => jpost("/encode", { name: name ?? null }) as Promise<{ ok: boolean; output: string; error: string | null }>;

/* ---------- radar ---------- */
export const getRadar = () => req<{ active: boolean; available: boolean }>("/radar");
export const setRadar = (active: boolean) => jpost("/radar", { active }) as Promise<{ active: boolean; available: boolean }>;

/* ---------- layout ---------- */
export interface LayoutEntry { id: string; position: string }
export interface ApiWindow { from: string; to: string; label: string; layout: LayoutEntry[] }
export interface ModuleInstance { id: string; type: string; values?: Record<string, unknown> }
export interface LayoutStore {
  defaults: Record<string, LayoutEntry[]>;
  windows: Record<string, Record<string, ApiWindow>>;
  instances: ModuleInstance[];
}
export const getLayout = () => req<LayoutStore>("/layout");
export const putLayout = (store: LayoutStore) => req<{ ok: boolean }>("/layout", { method: "PUT", body: JSON.stringify(store) });
export const applyLayout = () => jpost("/layout/apply") as Promise<{ ok: boolean; restarted: boolean; reload_needed: boolean }>;

/* ---------- module catalog (for the layout editor) ---------- */
export interface CatalogField { key: string; label: string; required?: boolean; type?: string; placeholder?: string; options?: { value: string; label: string }[] }
export interface CatalogEntry { type: string; module: string; label: string; fields?: CatalogField[] }
export const getModules = () => req<{ catalog: CatalogEntry[]; registered_ids: string[]; loaded_by_module: Record<string, string[]>; positions: string[] }>("/modules");

/* ---------- store ---------- */
export interface StoreMeta { name?: Record<string, string>; description?: Record<string, string>; tags?: string[]; screenshots?: string[] }
export interface StoreModule {
  id: string; name: string; url: string; description: string; category: string;
  maintainer?: string; stars?: number | null; image?: string | null; images?: string[];
  installed: boolean; own?: boolean; catalog?: StoreMeta;
}
export const storeCatalog = () => req<{ community: StoreModule[]; own: StoreModule[]; error: string | null }>("/store/catalog");
export const storeReadme = (id: string, url?: string) => req<{ markdown: string; baseUrl: string }>(`/store/readme?id=${encodeURIComponent(id)}${url ? `&url=${encodeURIComponent(url)}` : ""}`);
export const installModule = (id: string) => jpost("/store/install", { id }) as Promise<{ ok: boolean; started: boolean; name: string }>;
export const installStatus = (id: string) => req<{ phase: string; percent: number; done: boolean; ok?: boolean; error?: string | null; name?: string }>(`/store/install/status?id=${encodeURIComponent(id)}`);
export const uninstallModule = (name: string) => jpost("/store/uninstall", { name }) as Promise<{ ok: boolean; removed: string }>;

/* ---------- mqtt bridge (fallback publish via backend) ---------- */
export const mqttPublish = (topic: string, payload: unknown) => jpost("/api/mqtt/publish", { topic, payload });

/** Backend positions use `middle_center`; the app uses `middle`. */
export const posToRegion = (p: string): string => (p === "middle_center" ? "middle" : p);
export const regionToPos = (r: string): string => (r === "middle" ? "middle_center" : r);
