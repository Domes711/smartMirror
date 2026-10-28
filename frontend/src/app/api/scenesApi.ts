import { createApi } from "@reduxjs/toolkit/query/react";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";
import { onTopicJson } from "@/services/mqttTopicBus";

// Mirrors backend/features/scenes/mqtt.py exactly. Scenes is MQTT-only — no
// HTTP at all (see CLAUDE.md "no HTTP, no port").
const RPC = "smartmirror/scenes/rpc";
const TOPIC = {
  rpcLayoutGet: `${RPC}/layout/get`,
  rpcLayoutPut: `${RPC}/layout/put`,
  rpcLayoutApply: `${RPC}/layout/apply`,
  rpcModulesGet: `${RPC}/modules/get`,
  applied: "smartmirror/scenes/applied", // out: a new layout is live
} as const;

export interface LayoutEntry {
  id: string;
  position: string;
}
export interface ApiWindow {
  from: string;
  to: string;
  label: string;
  layout: LayoutEntry[];
}
export interface ModuleInstance {
  id: string;
  type: string;
  values?: Record<string, unknown>;
}
export interface LayoutStore {
  defaults: Record<string, LayoutEntry[]>;
  windows: Record<string, Record<string, ApiWindow>>;
  instances: ModuleInstance[];
}

export interface CatalogField {
  key: string;
  label: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}
export interface CatalogEntry {
  type: string;
  module: string;
  label: string;
  fields?: CatalogField[];
}
export interface ScenesModulesInfo {
  catalog: CatalogEntry[];
  registered_ids: string[];
  loaded_by_module: Record<string, string[]>;
  positions: string[];
}

export const scenesApi = createApi({
  reducerPath: "scenesApi",
  baseQuery: mqttBaseQuery,
  tagTypes: ["Layout", "ScenesModules"],
  endpoints: (build) => ({
    getLayout: build.query<LayoutStore, void>({
      query: () => ({ topic: TOPIC.rpcLayoutGet }),
      providesTags: ["Layout"],
      // smartmirror/scenes/applied fires whenever ANY client (this tab,
      // another device, the mirror itself) applies a new layout — refetch
      // so the editor never shows a stale store after someone else's apply.
      async onCacheEntryAdded(_arg, { cacheDataLoaded, cacheEntryRemoved, dispatch }) {
        await cacheDataLoaded;
        const unsub = onTopicJson(TOPIC.applied, () => {
          dispatch(scenesApi.util.invalidateTags(["Layout"]));
        });
        await cacheEntryRemoved;
        unsub();
      },
    }),

    putLayout: build.mutation<{ ok: boolean }, LayoutStore>({
      query: (store) => ({ topic: TOPIC.rpcLayoutPut, payload: { ...store } }),
      invalidatesTags: ["Layout"],
    }),

    applyLayout: build.mutation<{ ok: boolean; restarted: boolean; reload_needed: boolean }, void>({
      query: () => ({ topic: TOPIC.rpcLayoutApply }),
      invalidatesTags: ["Layout"],
    }),

    getScenesModules: build.query<ScenesModulesInfo, void>({
      query: () => ({ topic: TOPIC.rpcModulesGet }),
      providesTags: ["ScenesModules"],
    }),
  }),
});

export const { useGetLayoutQuery, usePutLayoutMutation, useApplyLayoutMutation, useGetScenesModulesQuery } = scenesApi;

/** Backend positions use `middle_center`; the app uses `middle`. */
export const posToRegion = (p: string): string => (p === "middle_center" ? "middle" : p);
export const regionToPos = (r: string): string => (r === "middle" ? "middle_center" : r);
