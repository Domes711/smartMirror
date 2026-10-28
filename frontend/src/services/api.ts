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
