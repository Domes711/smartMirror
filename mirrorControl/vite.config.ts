import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Dev server proxies the mirror's REST surface (camera stream, photo upload,
// layout, store) to the supervisor/Express on :8000 so the app can run with
// `npm run dev` against a real Pi. MQTT goes direct over WebSocket — see
// src/services/mqtt.ts (no proxy needed for ws://<pi>:9001).
const MIRROR_HTTP = process.env.VITE_MIRROR_HTTP || "http://10.0.0.249:8000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Supervisor/Express REST (proxied by mirror-console Express at :8000).
      "/mode": MIRROR_HTTP,
      "/healthz": MIRROR_HTTP,
      "/stream.mjpg": MIRROR_HTTP,
      "/capture": MIRROR_HTTP,
      "/encode": MIRROR_HTTP,
      "/dataset": MIRROR_HTTP,
      "/photo": MIRROR_HTTP,
      "/profiles": MIRROR_HTTP,
      "/radar": MIRROR_HTTP,
      "/modules": MIRROR_HTTP,
      "/layout": MIRROR_HTTP,
      "/store": MIRROR_HTTP,
      "/api": MIRROR_HTTP,
    },
  },
});
