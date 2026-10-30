import { createApi } from "@reduxjs/toolkit/query/react";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";
import { onTopicJson } from "@/services/mqttTopicBus";

// Mirrors backend/features/modules/constants.py exactly. The AI module
// builder is a separate feature (aiModulesApi.ts), MQTT-only, no overlap
// with the store here.
const RPC = "smartmirror/modules/rpc";
const TOPIC = {
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
  /** on-disk modules that are not our own (installed from the store, AI-built) */
  installed: StoreModule[];
  /** how many modules the browse list has in total (for the current q/tag) */
  total: number;
  offset: number;
  error: string | null;
}

/** Browse-list page size for the lazy store list. */
export const STORE_PAGE = 30;

export interface StoreBrowseArg {
  q: string;
  tag: string | null;
}

async function fetchCatalog(params: Record<string, string | number>) {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  try {
    const r = await fetch(`/store/catalog?${qs}`);
    if (!r.ok) return { error: { message: `HTTP ${r.status}`, status: r.status } };
    return { data: (await r.json()) as StoreCatalog };
  } catch (e) {
    return { error: { message: String(e) } };
  }
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
    // HTTP, not MQTT: the store is a big page-load read — exactly the
    // payload shape that stays on HTTP (GET /store/catalog via the gateway,
    // see backend/features/modules/http.py). Loaded lazily: this one is just
    // own + installed modules and the browse-list total (limit=0); the
    // browse list itself pages in via browseStore while scrolling.
    getStoreCatalog: build.query<StoreCatalog, void>({
      queryFn: () => fetchCatalog({ offset: 0, limit: 0 }),
      providesTags: ["StoreCatalog"],
    }),

    browseStore: build.infiniteQuery<StoreCatalog, StoreBrowseArg, number>({
      infiniteQueryOptions: {
        initialPageParam: 0,
        getNextPageParam: (last, _all, lastOffset) =>
          lastOffset + STORE_PAGE < last.total ? lastOffset + STORE_PAGE : undefined,
      },
      queryFn: ({ queryArg, pageParam }) =>
        fetchCatalog({ offset: pageParam, limit: STORE_PAGE, q: queryArg.q, tag: queryArg.tag || "" }),
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

export const { useGetStoreCatalogQuery, useBrowseStoreInfiniteQuery, useGetReadmeQuery, useInstallModuleMutation, useUninstallModuleMutation, useGetInstallStatusQuery } =
  modulesApi;
