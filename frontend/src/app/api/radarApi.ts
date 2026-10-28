import { createApi } from "@reduxjs/toolkit/query/react";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";
import { onTopicJson } from "@/services/mqttTopicBus";

// Mirrors backend/features/radar/mqtt.py exactly. Served by the camera
// supervisor (it already holds the systemctl sudoers rights) — the topic
// prefix is still radar's own, per CLAUDE.md.
const TOPIC = {
  rpcServiceGet: "smartmirror/radar/rpc/service/get",
  rpcServiceSet: "smartmirror/radar/rpc/service/set",
  status: "smartmirror/radar/status", // out: {active, available} (retained)
} as const;

export interface RadarServiceStatus {
  active: boolean;
  available: boolean;
}

export const radarApi = createApi({
  reducerPath: "radarApi",
  baseQuery: mqttBaseQuery,
  tagTypes: ["RadarStatus"],
  endpoints: (build) => ({
    getRadarStatus: build.query<RadarServiceStatus, void>({
      query: () => ({ topic: TOPIC.rpcServiceGet }),
      providesTags: ["RadarStatus"],
      async onCacheEntryAdded(_arg, { cacheDataLoaded, cacheEntryRemoved, updateCachedData }) {
        await cacheDataLoaded;
        const unsub = onTopicJson<RadarServiceStatus>(TOPIC.status, (data) => {
          updateCachedData(() => data);
        });
        await cacheEntryRemoved;
        unsub();
      },
    }),

    setRadarActive: build.mutation<RadarServiceStatus, boolean>({
      query: (active) => ({ topic: TOPIC.rpcServiceSet, payload: { active } }),
      invalidatesTags: ["RadarStatus"],
    }),
  }),
});

export const { useGetRadarStatusQuery, useSetRadarActiveMutation } = radarApi;
