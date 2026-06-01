// Express front-end for the smart mirror camera console.
//
// Serves the built React app (../web/dist) and proxies the API + MJPEG stream
// to the Python supervisor on 127.0.0.1:8001. Everything is reachable on a
// single LAN port (default 8000), e.g. http://10.0.0.249:8000.

const path = require("path");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const PORT = parseInt(process.env.PORT || "8000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const BACKEND = process.env.BACKEND || "http://127.0.0.1:8001";
const DIST = path.join(__dirname, "..", "web", "dist");

const app = express();

// Proxy supervisor endpoints. selfHandleResponse stays false so the multipart
// MJPEG stream is piped through untouched.
const proxy = createProxyMiddleware({
  target: BACKEND,
  changeOrigin: true,
  ws: false,
});
app.use("/mode", proxy);
app.use("/healthz", proxy);
app.use("/stream.mjpg", proxy);

// Static React build + SPA fallback.
app.use(express.static(DIST));
app.get("*", (_req, res) => {
  res.sendFile(path.join(DIST, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`mirror-console web on http://${HOST}:${PORT} -> ${BACKEND}`);
});
