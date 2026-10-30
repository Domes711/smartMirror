import { createApi } from "@reduxjs/toolkit/query/react";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";
import { onTopicJson } from "@/services/mqttTopicBus";

// Mirrors backend/features/modules/constants.py exactly. The AI module
// builder is a separate feature (aiModulesApi.ts), MQTT-only, no overlap
// with the store here.
const RPC = "smartmirror/modules/rpc";
const TOPIC = {
  rpcCatalog: `${RPC}/catalog`,
  rpcReadme: `${RPC}/readme`,
  rpcInstall: `${RPC}/install`,
  rpcInstallStatus: `${RPC}/install/status`,
  rpcUninstall: `${RPC}/uninstall`,
  // Install progress, pushed retained per module type as it changes —
  // backend/features/modules/constants.py's INSTALL_PROGRESS.
  installProgress: "smartmirror/modules/install/progress",
} as const;

export interface StoreMeta {
  name?: Record<string, string>;
  description?: Record<string, string>;
  tags?: string[];
  screenshots?: string[];
}
export interface StoreModule {
  id: string;
  name: string;
  url: string;
  description?: string;
  category: string;
  maintainer?: string;
  stars?: number | null;
  image?: string | null;
  images?: string[];
  installed: boolean;
  own?: boolean;
  catalog?: StoreMeta;
}
export interface StoreCatalog {
  community: StoreModule[];
  own: StoreModule[];
  error: string | null;
}

export interface InstallStatus {
  phase: string;
  percent: number;
  done: boolean;
  ok?: boolean;
  error?: string | null;
  name?: string;
}

export const modulesApi = createApi({
  reducerPath: "modulesApi",
  baseQuery: mqttBaseQuery,
  tagTypes: ["StoreCatalog", "InstallStatus"],
  endpoints: (build) => ({
    getStoreCatalog: build.query<StoreCatalog, void>({
      // The whole store (~1400 modules, ~1.5 MB) in one reply — mosquitto's
      // websocket listener is slow with a payload that size, so the default
      // 8 s RPC timeout is not enough on the Pi.
      query: () => ({ topic: TOPIC.rpcCatalog, timeoutMs: 45000 }),
      providesTags: ["StoreCatalog"],
    }),

    getReadme: build.query<{ markdown: string; baseUrl: string }, { id: string; url?: string }>({
      query: ({ id, url }) => ({ topic: TOPIC.rpcReadme, payload: { id, url } }),
    }),

    installModule: build.mutation<{ ok: boolean; started: boolean; name: string }, string>({
      query: (id) => ({ topic: TOPIC.rpcInstall, payload: { id } }),
    }),

    uninstallModule: build.mutation<{ ok: boolean; removed: string }, string>({
      query: (name) => ({ topic: TOPIC.rpcUninstall, payload: { name } }),
      invalidatesTags: ["StoreCatalog"],
    }),

    // One-shot status read (e.g. resuming a page mid-install). Prefer
    // subscribeInstallProgress below for anything rendering a live bar —
    // this is an RPC poll, the backend pushes retained progress instead.
    getInstallStatus: build.query<InstallStatus, string>({
      query: (id) => ({ topic: TOPIC.rpcInstallStatus, payload: { id } }),
      providesTags: (_r, _e, id) => [{ type: "InstallStatus", id }],
      // Subscribe to this module's retained progress topic and keep the
      // cache fresh — no polling loop needed in the component.
      async onCacheEntryAdded(id, { cacheDataLoaded, cacheEntryRemoved, updateCachedData }) {
        await cacheDataLoaded;
        const topic = `${TOPIC.installProgress}/${id}`;
        const unsub = onTopicJson<InstallStatus & { type: string }>(topic, (data) => {
          updateCachedData(() => data);
        });
        await cacheEntryRemoved;
        unsub();
      },
    }),
  }),
});

export const { useGetStoreCatalogQuery, useGetReadmeQuery, useInstallModuleMutation, useUninstallModuleMutation, useGetInstallStatusQuery } =
  modulesApi;
