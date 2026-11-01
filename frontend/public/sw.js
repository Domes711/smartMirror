/* Mirror Control service worker — app-shell offline cache.
 * Static build assets are cached (cache-first with background refresh);
 * live mirror data (REST fallback endpoints + MQTT) is always network-only.
 * CACHE is rewritten by vite.config.ts's swCacheBust plugin on every build —
 * a new name forces `activate` below to drop the previous build's cached
 * assets instead of serving stale ones whose vite-hashed filenames no
 * longer exist on the server (a blank white screen with no console error,
 * since the failure is an import() 404, not an app bug). */
const CACHE = "mirror-control-__BUILD_ID__";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

// never cache the REST fallback surface (proxied to the supervisor :8000)
const BYPASS = ["/mode", "/healthz", "/stream.mjpg", "/capture", "/encode", "/dataset", "/photo", "/profiles", "/radar", "/modules", "/layout", "/store", "/api", "/store-assets", "/module-installed", "/module-draft"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // MQTT ws + cross-origin: untouched
  if (BYPASS.some((p) => url.pathname.startsWith(p))) return; // live data: network-only

  // SPA navigations → network, fall back to cached shell when offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))));
    return;
  }

  // assets → cache-first, refresh in the background
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
