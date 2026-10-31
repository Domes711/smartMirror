import { createApi } from "@reduxjs/toolkit/query/react";
import type { BaseQueryFn } from "@reduxjs/toolkit/query";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";
import { publish } from "@/services/mqtt";
import { onTopicJson } from "@/services/mqttTopicBus";

// Mirrors backend/features/radar/mqtt.py exactly. Served by the camera
// supervisor (it already holds the systemctl sudoers rights) — the topic
// prefix is still radar's own, per CLAUDE.md.
const TOPIC = {
  rpcServiceGet: "smartmirror/radar/rpc/service/get",
  rpcServiceSet: "smartmirror/radar/rpc/service/set",
  status: "smartmirror/radar/status", // out: {active, available} (retained)
  config: "smartmirror/radar/config", // out: current calibration (retained)
  control: "smartmirror/radar/control", // in: {cmd, ...} calibration commands
} as const;

export interface RadarServiceStatus {
  active: boolean;
  available: boolean;
}

export interface RadarConfig {
  zone: { x: number; y: number };
  x_offset: number;
  invert_x: boolean;
  enter_frames: number;
  max_range_mm: number;
  min_speed: number;
  alpha: number;
  deadband_mm: number;
  exclusions: [number, number][];
}

// radar/control is fire-and-forget, plain-JSON commands (daemon.py's
// RadarState.handle()) — not the _rid/_reply RPC pattern other features use.
// The confirmation is the retained CONFIG republish, same shape as
// display's plain /control/<name> topics.
const radarControlBaseQuery: BaseQueryFn<{ cmd: string; [k: string]: unknown }, unknown, { message: string }> = async (
  cmd
) => {
  publish(TOPIC.control, cmd);
  return { data: { ok: true } };
};

export const radarApi = createApi({
  reducerPath: "radarApi",
  baseQuery: mqttBaseQuery,
  tagTypes: ["RadarStatus", "RadarConfig"],
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

// Separate `createApi` instance: radarConfig's "query" is a plain control
// publish, not an MQTT RPC round trip, so it needs the dedicated baseQuery
// above rather than mqttBaseQuery.
export const radarConfigApi = createApi({
  reducerPath: "radarConfigApi",
  baseQuery: radarControlBaseQuery,
  tagTypes: ["RadarConfig"],
  endpoints: (build) => ({
    getRadarConfig: build.query<RadarConfig, void>({
      query: () => ({ cmd: "get_config" }),
      providesTags: ["RadarConfig"],
      async onCacheEntryAdded(_arg, { cacheDataLoaded, cacheEntryRemoved, updateCachedData }) {
        await cacheDataLoaded;
        const unsub = onTopicJson<RadarConfig>(TOPIC.config, (data) => {
          updateCachedData(() => data);
        });
        await cacheEntryRemoved;
        unsub();
      },
    }),

    setRadarConfig: build.mutation<{ ok: boolean }, Partial<RadarConfig>>({
      query: (config) => ({ cmd: "set_config", config }),
    }),

    centerRadarOnNearestTarget: build.mutation<{ ok: boolean }, void>({
      query: () => ({ cmd: "set_center" }),
    }),

    flipRadarAxis: build.mutation<{ ok: boolean }, void>({
      query: () => ({ cmd: "set_axis" }),
    }),

    learnRadarGhosts: build.mutation<{ ok: boolean }, number | void>({
      query: (seconds) => ({ cmd: "baseline", seconds: seconds ?? 10 }),
    }),

    resetRadarConfig: build.mutation<{ ok: boolean }, void>({
      query: () => ({ cmd: "reset" }),
    }),
  }),
});

export const { useGetRadarStatusQuery, useSetRadarActiveMutation } = radarApi;
export const {
  useGetRadarConfigQuery,
  useSetRadarConfigMutation,
  useCenterRadarOnNearestTargetMutation,
  useFlipRadarAxisMutation,
  useLearnRadarGhostsMutation,
  useResetRadarConfigMutation,
} = radarConfigApi;
