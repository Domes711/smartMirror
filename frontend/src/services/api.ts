// Pure URL-builder helpers for same-origin binary/file endpoints that RTK
// Query doesn't cover (streams, photo files, the live mirror display). All
// JSON state goes through the MQTT RTK Query slices in app/api/*.ts — see
// CLAUDE.md "What is MQTT and what stays HTTP".

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

/** Upload a photo captured by the CLIENT device's own camera (phone/laptop
 * browser) as training data for `name` — distinct from the MQTT RPC
 * capturePhoto, which grabs a frame from the mirror's own camera. Raw body,
 * same-origin as /photo and /stream.mjpg.
 *
 * An unreachable backend (dev proxy pointed at a LAN host that's off) makes
 * a plain fetch hang indefinitely with no error — the caller would see no
 * feedback at all. Abort after 15s so the UI always gets a result. */
export async function uploadCapturedPhoto(name: string, blob: Blob, file?: string): Promise<{ file: string; total: number }> {
  const qs = new URLSearchParams({ name });
  if (file) qs.set("file", file);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`/capture-upload?${qs.toString()}`, { method: "POST", body: blob, signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("upload timed out — mirror unreachable");
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `upload failed (${res.status})`);
  }
  return res.json();
}
