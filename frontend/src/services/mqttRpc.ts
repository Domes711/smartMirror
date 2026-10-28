import { getClient, publish } from "@/services/mqtt";

/**
 * MQTT RPC client — the browser-side half of the request/reply pattern
 * implemented once in `backend/shared/mqtt_client.py`'s `MqttClient.serve()`:
 *
 *   request  → <endpoint topic>      {"_rid": …, "_reply": …, <args>}
 *   reply    → the "_reply" topic    {"_rid": …, "ok": true,  …result}
 *                                    {"_rid": …, "ok": false, "error": …,
 *                                     "status": 404|409|500}
 *
 * `_rid` lets several in-flight requests share one reply topic without
 * cross-talk; `status` carries the old HTTP status for callers that used to
 * distinguish 404 from 409. See CLAUDE.md "What is MQTT and what stays HTTP".
 *
 * One reply topic per browser tab (not per call) — each request gets a
 * fresh `_rid` and is matched by it, so concurrent calls don't need a
 * subscribe/unsubscribe round trip each.
 */

export const REPLY_TOPIC = "mirror-control/rpc-reply/" + Math.random().toString(16).slice(2, 10);

export class RpcError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RpcError";
    this.status = status;
  }
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (reason: RpcError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const waiters = new Map<string, Waiter>();

/** Call from the app's onConnect handler (app/mirrorBridge.ts) — a fresh
 * connection (first load, or after a reconnect) needs the reply topic
 * re-subscribed; the broker does not remember it across a dropped session. */
export function subscribeRpcReplies(): void {
  getClient()?.subscribe(REPLY_TOPIC);
}

/** Call once from the app's MQTT message handler — see app/connect.ts. */
export function handleRpcReply(topic: string, payload: string): boolean {
  if (topic !== REPLY_TOPIC) return false;
  let msg: { _rid?: string; ok?: boolean; error?: string; status?: number; [k: string]: unknown };
  try {
    msg = JSON.parse(payload);
  } catch {
    return true; // consumed, but not parseable — nothing to resolve
  }
  const rid = msg._rid;
  if (!rid) return true;
  const waiter = waiters.get(rid);
  if (!waiter) return true; // late reply after our own timeout, or not ours
  waiters.delete(rid);
  clearTimeout(waiter.timer);
  if (msg.ok === false) {
    waiter.reject(new RpcError(msg.error || "RPC error", msg.status));
  } else {
    const { _rid: _r, ok: _ok, ...result } = msg;
    waiter.resolve(result);
  }
  return true;
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Call a backend RPC endpoint (`smartmirror/<feature>/rpc/...`). Resolves
 * with the reply payload (envelope keys stripped), rejects with RpcError on
 * `ok:false` or on timeout (e.g. the owning unit is down — same case a 502
 * from the gateway used to cover).
 */
export function rpcCall<T = unknown>(
  topic: string,
  args: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const rid = Math.random().toString(16).slice(2, 10) + Date.now().toString(16);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(rid);
      reject(new RpcError(`RPC timeout: ${topic}`));
    }, timeoutMs);
    waiters.set(rid, { resolve: resolve as (v: unknown) => void, reject, timer });
    publish(topic, { ...args, _rid: rid, _reply: REPLY_TOPIC });
  });
}

/** Fire-and-forget — omits `_reply`, exactly like publish() but through the
 * same call shape as rpcCall() for symmetry in endpoint definitions. */
export function rpcSend(topic: string, args: Record<string, unknown> = {}): void {
  publish(topic, args);
}
