// Real mirror-console backend client. All paths are same-origin (served from
// the Pi in prod; proxied to :8000 in dev — see vite.config.ts). Shapes match
// mirror-console/server/index.js + backend/supervisor.py.

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.clone().json();
      if (j && typeof j.error === "string") detail = ` — ${j.error}`;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`${init?.method || "GET"} ${path} → ${res.status}${detail}`);
  }
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

/** URL of the live MagicMirror display (its own web server, default :8080).
 * Same host as the app, port 8080; override with VITE_MIRROR_DISPLAY_URL. */
export function mirrorDisplayUrl(): string {
  const env = import.meta.env.VITE_MIRROR_DISPLAY_URL as string | undefined;
  if (env) return env;
  // dev: derive from VITE_MIRROR_HTTP (…:8000 → …:8080)
  const http = import.meta.env.VITE_MIRROR_HTTP as string | undefined;
  if (import.meta.env.DEV && http) return http.replace(/:\d+/, ":8080");
  const host = typeof location !== "undefined" ? location.hostname : "127.0.0.1";
  const scheme = typeof location !== "undefined" ? location.protocol : "http:";
  return `${scheme}//${host}:8080`;
}

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
export interface CatalogField { key: string; label: string; required?: boolean; type?: string; placeholder?: string; help?: string; options?: { value: string; label: string }[] }
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

/* ---------- AI module builder (Claude Agent SDK + SSE) ---------- */
export interface AiMsg { role: "user" | "assistant" | "sys"; text: string; files?: string[]; ts?: number }
export const aiStatus = () => req<{ claudeCli: boolean; claudeVersion?: string; model?: string }>("/api/modules/ai-status");
export const aiListDrafts = () => req<{ drafts: { name: string; description: string }[] }>("/api/modules/list");
export const aiCreateDraft = (name: string, description: string) =>
  jpost("/api/modules/draft", { name, description }) as Promise<{ ok: boolean; name: string; rev: number }>;
export const aiSession = (name: string, scope: "draft" | "installed" = "draft") =>
  req<{ name: string; scope: string; description: string; prepared: boolean; messages: AiMsg[]; rev: number }>(`/api/modules/session?name=${encodeURIComponent(name)}&scope=${scope}`);
export const aiChat = (name: string, scope: "draft" | "installed", message: string) =>
  jpost("/api/modules/chat", { name, scope, message });
export const aiFinalize = (name: string, overwrite = false) =>
  jpost("/api/modules/finalize", { name, overwrite }) as Promise<{ ok: boolean; name?: string; message?: string; exists?: boolean; error?: string }>;
export const aiDemoUrl = (name: string, scope: "draft" | "installed", rev: number) =>
  `${scope === "installed" ? "/module-installed" : "/module-draft"}/${encodeURIComponent(name)}/demo.html?v=${rev}`;

export interface AiEvent { type: "connected" | "text" | "tool" | "error" | "done"; text?: string; tool?: string; file?: string; rev?: number; touched?: boolean }
/** Open the live agent SSE stream. Caller must close() the returned source. */
export function aiStream(name: string, scope: "draft" | "installed", onEvent: (e: AiEvent) => void): EventSource {
  const es = new EventSource(`/api/modules/chat/stream?name=${encodeURIComponent(name)}&scope=${scope}`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore keep-alives */
    }
  };
  return es;
}

/** Backend positions use `middle_center`; the app uses `middle`. */
export const posToRegion = (p: string): string => (p === "middle_center" ? "middle" : p);
export const regionToPos = (r: string): string => (r === "middle" ? "middle_center" : r);
