import type { BaseQueryFn } from "@reduxjs/toolkit/query";
import { rpcCall, RpcError } from "@/services/mqttRpc";

/**
 * RTK Query `baseQuery` whose "HTTP request" is an MQTT RPC round trip
 * (`services/mqttRpc.ts`, the browser half of `backend/shared/mqtt_client.py`'s
 * `MqttClient.serve()` pattern). Every `createApi()` slice in `app/api/`
 * plugs this in instead of `fetchBaseQuery`, so the rest of RTK Query (cache,
 * tags, invalidation, loading states, hooks) works unchanged — only how a
 * query/mutation actually reaches the backend differs.
 *
 * Query/mutation `args` shape: `{ topic: string, payload?: Record<string, unknown> }`.
 */
export interface MqttQueryArgs {
  topic: string;
  payload?: Record<string, unknown>;
  /** override the default RPC timeout (large replies) */
  timeoutMs?: number;
}

export const mqttBaseQuery: BaseQueryFn<MqttQueryArgs, unknown, { message: string; status?: number }> = async ({
  topic,
  payload,
  timeoutMs,
}) => {
  try {
    const data = await rpcCall(topic, payload ?? {}, timeoutMs);
    return { data };
  } catch (e) {
    const err = e instanceof RpcError ? e : new RpcError(String(e));
    return { error: { message: err.message, status: err.status } };
  }
};
