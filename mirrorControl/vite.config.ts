import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Dev server proxies the mirror's REST surface (camera stream, photo upload,
// layout, store) to the supervisor/Express on :8000 so the app can run with
// `npm run dev` against a real Pi. MQTT goes direct over WebSocket — see
// src/services/mqtt.ts (no proxy needed for ws://<pi>:9001).
const MIRROR_HTTP = process.env.VITE_MIRROR_HTTP || "http://10.0.0.249:8000";

// REST fallback endpoints (camera stream, photo upload, layout, store) are
// proxied to the supervisor/Express on :8000 in BOTH dev and preview, so the
// built app served from the Pi stays same-origin. MQTT goes direct over
// WebSocket (ws://<host>:9001) — no proxy needed. See src/services/mqtt.ts.
const restProxy = Object.fromEntries(
  [
    "/mode", "/healthz", "/stream.mjpg", "/capture", "/encode", "/dataset",
    "/photo", "/profiles", "/radar", "/modules", "/layout", "/store", "/api",
    "/store-assets", "/module-installed",
  ].map((p) => [p, MIRROR_HTTP])
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: true,
    port: 5173,
    proxy: restProxy,
  },
  // `vite preview` serves the production build (dist/) — this is what the
  // mirror-control systemd unit runs on the Pi. See deploy.sh.
  preview: {
    host: true,
    port: 8090,
    proxy: restProxy,
  },
});
