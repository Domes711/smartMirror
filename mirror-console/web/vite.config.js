import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev`, proxy the supervisor endpoints to the Python backend
// so the dev server behaves like the production Express front-end.
const BACKEND = process.env.BACKEND || "http://127.0.0.1:8001";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose dev server on the LAN too
    proxy: {
      "/mode": BACKEND,
      "/healthz": BACKEND,
      "/stream.mjpg": BACKEND,
    },
  },
});
