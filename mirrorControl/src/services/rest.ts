/**
 * REST is the FALLBACK transport — used only for what MQTT can't carry:
 * the camera MJPEG stream, single-frame JPEGs, photo upload, and the few
 * supervisor operations that are inherently request/response (layout GET/PUT,
 * store catalog/install). Everything else goes over MQTT (services/mqtt.ts).
 *
 * Endpoints match mirror-console: supervisor.py (proxied by Express :8000).
 */
const BASE = (import.meta.env.VITE_MIRROR_HTTP as string | undefined) || "";

const url = (p: string) => (BASE ? BASE.replace(/\/$/, "") + p : p);

async function json<T>(p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(p), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method || "GET"} ${p} → ${res.status}`);
  return res.json() as Promise<T>;
}

// --- camera (binary, REST-only) ---
/** Live MJPEG stream URL for an <img src>. */
export const streamUrl = () => url("/stream.mjpg");
/** Single still frame; cache-busted. */
export const photoUrl = (name: string, file: string) =>
  url(`/photo?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`);

export const capturePhoto = (name: string, file?: string) =>
  json<{ photos: string[] }>("/capture", { method: "POST", body: JSON.stringify({ name, file }) });

export const listPhotos = (name: string) =>
  json<{ name: string; photos: string[] }>(`/dataset?name=${encodeURIComponent(name)}`);

export const deletePhoto = (name: string, file: string) =>
  json<{ ok: boolean; photos: string[] }>(
    `/dataset?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`,
    { method: "DELETE" }
  );

/** Retrain face encodings (optionally for one profile). */
export const encodeDataset = (name?: string | null) =>
  json<unknown>("/encode", { method: "POST", body: JSON.stringify({ name: name ?? null }) });

// --- camera arbiter mode ---
export const getMode = () => json<{ mode: string }>("/mode");
export const setMode = (mode: string) =>
  json<unknown>("/mode", { method: "POST", body: JSON.stringify({ mode }) });

// --- profiles ---
export const listProfiles = () => json<{ profiles: string[] }>("/profiles");
export const removeProfile = (name: string) =>
  json<unknown>(`/profiles?name=${encodeURIComponent(name)}`, { method: "DELETE" });

// --- radar status (live targets come over MQTT; this is the REST snapshot) ---
export const radarStatus = () => json<Record<string, unknown>>("/radar");
export const setRadar = (active: boolean) =>
  json<unknown>("/radar", { method: "POST", body: JSON.stringify({ active }) });

// --- layout (pages.js) ---
export const getLayout = () => json<Record<string, unknown>>("/layout");
export const saveLayout = (layout: unknown) =>
  json<unknown>("/layout", { method: "PUT", body: JSON.stringify(layout) });
export const applyLayout = () => json<unknown>("/layout/apply", { method: "POST" });

// --- store ---
export const listModules = () => json<Record<string, unknown>>("/modules");
export const storeCatalog = () => json<Record<string, unknown>>("/store/catalog");
export const installModule = (id: string) =>
  json<unknown>("/store/install", { method: "POST", body: JSON.stringify({ id }) });
export const uninstallModule = (name: string) =>
  json<unknown>("/store/uninstall", { method: "POST", body: JSON.stringify({ name }) });
export const installStatus = (id: string) =>
  json<{ pct?: number; done?: boolean }>(`/store/install/status?id=${encodeURIComponent(id)}`);

export const health = () => json<Record<string, unknown>>("/healthz");
