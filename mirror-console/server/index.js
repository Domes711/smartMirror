// Express front-end for the smart mirror camera console.
//
// Serves the built React app (../web/dist) and:
//   - proxies the camera supervisor (/mode, /healthz, /stream.mjpg) on :8001
//   - bridges MQTT: publish test messages (/api/mqtt/publish) and stream all
//     smartmirror/# traffic to the browser over SSE (/api/mqtt/stream)
// Everything is reachable on a single LAN port (default 8000).

const path = require("path");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const mqtt = require("mqtt");
const { mountModuleAI } = require("./module-ai");

const PORT = parseInt(process.env.PORT || "8000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const BACKEND = process.env.BACKEND || "http://127.0.0.1:8001";
const MQTT_URL = process.env.MQTT_URL || "mqtt://127.0.0.1:1883";
const DIST = path.join(__dirname, "..", "web", "dist");

const app = express();

// --- MQTT bridge ---------------------------------------------------------
const mqttClient = mqtt.connect(MQTT_URL, { reconnectPeriod: 2000 });
let mqttConnected = false;
const sseClients = new Set();

mqttClient.on("connect", () => {
  mqttConnected = true;
  console.log(`mqtt connected: ${MQTT_URL}`);
  mqttClient.subscribe("smartmirror/#");
});
mqttClient.on("reconnect", () => console.log("mqtt reconnecting…"));
mqttClient.on("close", () => {
  mqttConnected = false;
});
mqttClient.on("error", (e) => console.error("mqtt error:", e.message));

// Fan out every smartmirror/# message to connected SSE clients (live monitor).
mqttClient.on("message", (topic, payload) => {
  const line = `data: ${JSON.stringify({
    ts: Date.now(),
    topic,
    payload: payload.toString(),
  })}\n\n`;
  for (const res of sseClients) res.write(line);
});

// --- supervisor proxy ----------------------------------------------------
// Mounted at root with a pathFilter so the full path is preserved and the
// MJPEG stream is piped untouched. Must come before express.json() so the
// proxied POST /mode body streams through intact.
app.use(
  createProxyMiddleware({
    target: BACKEND,
    changeOrigin: true,
    ws: false,
    pathFilter: (p) =>
      p === "/mode" ||
      p === "/healthz" ||
      p.startsWith("/stream.mjpg") ||
      p === "/capture" ||
      p === "/encode" ||
      p.startsWith("/dataset") ||
      p.startsWith("/photo") ||
      p.startsWith("/profiles") ||
      p === "/radar" ||
      p === "/modules" ||
      p.startsWith("/layout") ||
      p.startsWith("/store"),
  })
);

app.use(express.json());

// --- MQTT API ------------------------------------------------------------
app.get("/api/mqtt/status", (_req, res) => {
  res.json({ connected: mqttConnected, url: MQTT_URL });
});

app.post("/api/mqtt/publish", (req, res) => {
  const { topic, payload } = req.body || {};
  if (!topic) return res.status(400).json({ error: "topic required" });
  const msg =
    typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  mqttClient.publish(topic, msg, { qos: 1 }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, topic, payload: msg });
  });
});

// --- AI module builder (chat with Claude to scaffold new modules) --------
mountModuleAI(app, express);

// Server-Sent Events: live feed of all smartmirror/# traffic.
app.get("/api/mqtt/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write(
    `data: ${JSON.stringify({ ts: Date.now(), system: "connected" })}\n\n`
  );
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// --- static React build + SPA fallback ----------------------------------
app.use(express.static(DIST));
app.get("*", (_req, res) => {
  res.sendFile(path.join(DIST, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`mirror-console web on http://${HOST}:${PORT} -> ${BACKEND}`);
});
