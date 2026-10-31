import { createApi } from "@reduxjs/toolkit/query/react";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";

// Mirrors backend/features/distance/mqtt.py exactly.
const TOPIC = {
  rpcConfigGet: "smartmirror/distance/rpc/config/get",
  rpcConfigSet: "smartmirror/distance/rpc/config/set",
} as const;

export interface DistanceConfig {
  warn_cm: number;
  max_range_cm: number;
  avg_window_ms: number;
  absent_after_n: number;
}

export const distanceApi = createApi({
  reducerPath: "distanceApi",
  baseQuery: mqttBaseQuery,
  tagTypes: ["DistanceConfig"],
  endpoints: (build) => ({
    getDistanceConfig: build.query<DistanceConfig, void>({
      query: () => ({ topic: TOPIC.rpcConfigGet }),
      providesTags: ["DistanceConfig"],
    }),

    setDistanceConfig: build.mutation<DistanceConfig, Partial<DistanceConfig>>({
      query: (values) => ({ topic: TOPIC.rpcConfigSet, payload: values }),
      invalidatesTags: ["DistanceConfig"],
    }),
  }),
});

export const { useGetDistanceConfigQuery, useSetDistanceConfigMutation } = distanceApi;
