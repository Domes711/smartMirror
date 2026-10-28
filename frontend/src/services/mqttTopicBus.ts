/**
 * Fan-out for retained/pushed MQTT state (camera/state, radar/status,
 * modules/install/progress, …) — the backend publishes these unprompted
 * (see CLAUDE.md "State is pushed retained, never polled"), so the frontend
 * should subscribe once and update its cache on each message, not RPC-poll
 * for them.
 *
 * `connectMqtt()` (services/mqtt.ts) already subscribes to the single
 * wildcard `smartmirror/#`, so every message already arrives at one place —
 * mirrorBridge.ts's onMessage handler, which calls publishToTopicBus() for
 * every topic. This module is just the fan-out from there to whichever
 * RTK Query `onCacheEntryAdded` listeners (app/api/*.ts) want a given topic.
 */

type Listener = (payload: string) => void;

const listeners = new Map<string, Set<Listener>>();

export function publishToTopicBus(topic: string, payload: string): void {
  listeners.get(topic)?.forEach((fn) => fn(payload));
}

/** Subscribe to one topic's raw payloads. Returns an unsubscribe function. */
export function onTopic(topic: string, fn: Listener): () => void {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic)!.add(fn);
  return () => {
    listeners.get(topic)?.delete(fn);
    if (listeners.get(topic)?.size === 0) listeners.delete(topic);
  };
}

/** Subscribe to one topic's JSON-parsed payloads; malformed/non-JSON
 * payloads (e.g. radar/presence's plain "present"/"absent") are skipped. */
export function onTopicJson<T = unknown>(topic: string, fn: (data: T) => void): () => void {
  return onTopic(topic, (payload) => {
    try {
      fn(JSON.parse(payload));
    } catch {
      /* not JSON — caller wanted parsed data, so this message isn't for them */
    }
  });
}
