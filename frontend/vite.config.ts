import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

// The device camera (getUserMedia, used by the new-profile wizard and
// AddPhotos) only works in a secure context — HTTPS, or localhost. The app
// is normally reached at http://<pi-ip>:8090, a plain-HTTP LAN address, so
// without this the browser never exposes navigator.mediaDevices at all.
// The root setup.sh generates one shared self-signed cert into
// backend/var/tls/ (shared with mosquitto's WebSocket listener — a
// https:// page cannot open a plain ws:// socket, so :9001 needs wss:// with
// this same cert once the frontend is HTTPS; see setup.sh and
// backend/features/camera/setup.sh). Fall back to plain HTTP if it's
// missing (dev machines, CI) rather than failing the whole config.
const TLS_DIR = path.resolve(__dirname, "../backend/var/tls");
const TLS_KEY = path.join(TLS_DIR, "key.pem");
const TLS_CERT = path.join(TLS_DIR, "cert.pem");
const https = fs.existsSync(TLS_KEY) && fs.existsSync(TLS_CERT)
  ? { key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) }
  : undefined;

// Dev server proxies the mirror's REST surface (camera stream, photo upload,
// layout, store, AI builder) to the backend gateway on :8000 so the app can
// run with `npm run dev` against a real Pi. MQTT goes direct over WebSocket —
// see src/services/mqtt.ts (no proxy needed for ws://<pi>:9001).
const MIRROR_HTTP = process.env.VITE_MIRROR_HTTP || "http://10.0.0.249:8000";

// REST endpoints are proxied to the backend gateway on :8000 in BOTH dev and
// preview, so the built app served from the Pi stays same-origin. The gateway
// routes each path on to the feature that owns it (camera :8001, scenes
// :8002, modules :8003) — see backend/gateway.py. MQTT goes direct over
// WebSocket (ws://<host>:9001) — no proxy. See src/services/mqtt.ts.
const restProxy = Object.fromEntries(
  [
    // camera
    "/mode", "/healthz", "/resolution", "/stream.mjpg", "/capture",
    "/capture-upload", "/encode", "/dataset", "/photo", "/profiles", "/radar",
    // scenes
    "/layout", "/modules",
    // modules (store + AI builder)
    "/store", "/api/modules", "/module-assets", "/module-installed",
    "/module-draft",
  ].map((p) => [p, MIRROR_HTTP])
);

// Never let the browser cache the HTML shell (or the SW) — so a redeploy is
// picked up immediately instead of serving a stale index.html that points at
// old hashed assets. Hashed assets stay immutable-cached.
const noCacheHtml: PluginOption = {
  name: "no-cache-html",
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || "").split("?")[0];
      const isHtml = url === "/" || url.endsWith(".html") || url === "/sw.js" || !url.includes(".");
      if (isHtml) res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      next();
    });
  },
};

// public/sw.js's CACHE constant holds a `__BUILD_ID__` placeholder; every
// `vite build` stamps a fresh unique id in, so the new worker's `activate`
// handler always sees a cache name it has never seen before and drops the
// previous build's assets — otherwise a stale cached bundle would keep
// serving its own vite-hashed filenames, which 404 the moment a new deploy
// has run (a blank white screen, not a visible error).
const swCacheBust: PluginOption = {
  name: "sw-cache-bust",
  closeBundle() {
    const swPath = path.resolve(__dirname, "dist/sw.js");
    if (!fs.existsSync(swPath)) return;
    const buildId = `${Date.now()}`;
    const contents = fs.readFileSync(swPath, "utf8").replace("__BUILD_ID__", buildId);
    fs.writeFileSync(swPath, contents);
  },
};

export default defineConfig({
  plugins: [react(), noCacheHtml, swCacheBust],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: true,
    port: 5173,
    proxy: restProxy,
    https,
  },
  // `vite preview` serves the production build (dist/) — this is what the
  // mirror-control systemd unit runs on the Pi. See deploy.sh.
  preview: {
    host: true,
    port: 8090,
    proxy: restProxy,
    https,
  },
});
