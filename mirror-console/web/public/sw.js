// Service worker for the Mirror Console PWA.
//
// Goal: make the console installable ("Přidat na plochu") and let the app
// shell load even on a flaky LAN — WITHOUT ever caching the live backend
// (camera MJPEG stream, SSE bus, supervisor + /api proxy). Those must always
// hit the network or the console would show stale/dead data.

const CACHE = "mirror-console-v1";

// Endpoints served by the Express proxy / Python supervisor / MQTT bridge.
// The SW must stay out of their way (no caching, no interception).
const BYPASS = [
  "/mode",
  "/healthz",
  "/stream.mjpg",
  "/capture",
  "/encode",
  "/dataset",
  "/photo",
  "/profiles",
  "/radar",
  "/modules",
  "/layout",
  "/api/",
];

self.addEventListener("install", (event) => {
  // Cache the entry document so a cold start works offline; hashed JS/CSS get
  // picked up at runtime by the stale-while-revalidate handler below.
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(["/", "/index.html"]).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin
  if (BYPASS.some((p) => url.pathname.startsWith(p))) return; // live backend

  // SPA navigations: network-first, fall back to cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => caches.match("/index.html").then((r) => r || caches.match("/"))
      )
    );
    return;
  }

  // Static assets (hashed JS/CSS, icons, manifest): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
