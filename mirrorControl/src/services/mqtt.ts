import mqtt, { type MqttClient } from "mqtt";

/**
 * MQTT is the PRIMARY transport between this app and the mirror. The browser
 * connects directly to the broker over WebSocket (mosquitto `listener 9001` /
 * `protocol websockets` — see README). Only payloads MQTT can't carry well
 * (camera MJPEG stream, photo upload) go over REST — see services/rest.ts.
 *
 * Topics mirror the ones used across the repo (ld2450/, camera/, profile.js):
 */
export const TOPICS = {
  // radar (LD2450 daemon → bus)
  radarPresence: "smartmirror/radar/presence", // "present" | "absent"
  radarTargets: "smartmirror/radar/targets", // JSON: { targets: [{x,y,speed}], ... }
  radarControl: "smartmirror/radar/control", // app → daemon (on/off, calibration cmds)
  radarConfig: "smartmirror/radar/config", // app → daemon (zone/offset/mirror …)
  // camera (face/gesture daemons → bus)
  cameraRecognition: "smartmirror/camera/recognition", // JSON: { user: string|null }
  cameraGesture: "smartmirror/camera/gesture",
  // profile system (core ⇄ console)
  controlReset: "smartmirror/control/reset",
  profilePreview: "smartmirror/profile/preview", // app → core: live layout preview
  profileReload: "smartmirror/profile/reload", // app → core: re-read pages.js
  // app-originated control surface (consumed by core / HA bridges)
  wake: "smartmirror/control/wake",
} as const;

export const ALL_TOPICS = "smartmirror/#";

export interface MqttHandlers {
  onConnect?: () => void;
  onClose?: () => void;
  onMessage?: (topic: string, payload: string) => void;
}

/** Resolve the broker WS URL: explicit env, else ws://<page-host>:9001. */
export function resolveMqttUrl(): string {
  const env = import.meta.env.VITE_MQTT_URL as string | undefined;
  if (env) return env;
  const host = typeof location !== "undefined" ? location.hostname : "127.0.0.1";
  const scheme = typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${host}:9001`;
}

let client: MqttClient | null = null;

export function getClient(): MqttClient | null {
  return client;
}

export function connectMqtt(handlers: MqttHandlers): MqttClient {
  const url = resolveMqttUrl();
  client = mqtt.connect(url, {
    reconnectPeriod: 2000,
    connectTimeout: 8000,
    clientId: "mirror-control-" + Math.random().toString(16).slice(2, 8),
  });
  client.on("connect", () => {
    client?.subscribe(ALL_TOPICS);
    handlers.onConnect?.();
  });
  client.on("close", () => handlers.onClose?.());
  client.on("message", (topic, payload) => handlers.onMessage?.(topic, payload.toString()));
  client.on("error", (e) => console.warn("[mqtt]", e.message));
  return client;
}

export function publish(topic: string, payload: unknown): void {
  const msg = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  client?.publish(topic, msg, { qos: 1 });
}

export function isConnected(): boolean {
  return !!client?.connected;
}
