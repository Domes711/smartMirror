import { createApi } from "@reduxjs/toolkit/query/react";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";

// Mirrors backend/features/mic/constants.py exactly. New feature — not yet
// used anywhere in the UI, included here so the data layer is complete.
const RPC = "smartmirror/mic/rpc";
const TOPIC = {
  rpcConfigGet: `${RPC}/config/get`,
  rpcConfigSet: `${RPC}/config/set`,
  rpcTestRecord: `${RPC}/test_record`,
  rpcServiceGet: `${RPC}/service/get`,
  rpcServiceSet: `${RPC}/service/set`,
} as const;

export interface MicConfig {
  device: string;
  satellite_name: string;
  wake_word: string;
  input_gain: number;
}
export type MicConfigInput = Partial<MicConfig>;

export interface MicServiceStatus {
  active: boolean;
  available: boolean;
}

export const micApi = createApi({
  reducerPath: "micApi",
  baseQuery: mqttBaseQuery,
  tagTypes: ["MicConfig", "MicService"],
  endpoints: (build) => ({
    getMicConfig: build.query<MicConfig, void>({
      query: () => ({ topic: TOPIC.rpcConfigGet }),
      providesTags: ["MicConfig"],
    }),

    setMicConfig: build.mutation<MicConfig, MicConfigInput>({
      query: (values) => ({ topic: TOPIC.rpcConfigSet, payload: { ...values } }),
      invalidatesTags: ["MicConfig"],
    }),

    testMicRecording: build.mutation<{ ok: boolean; id: string; seconds: number }, number>({
      query: (seconds) => ({ topic: TOPIC.rpcTestRecord, payload: { seconds } }),
    }),

    getMicServiceStatus: build.query<MicServiceStatus, void>({
      query: () => ({ topic: TOPIC.rpcServiceGet }),
      providesTags: ["MicService"],
    }),

    setMicServiceActive: build.mutation<MicServiceStatus, boolean>({
      query: (active) => ({ topic: TOPIC.rpcServiceSet, payload: { active } }),
      invalidatesTags: ["MicService"],
    }),
  }),
});

/** URL of the last test recording's WAV bytes — binary, not RTK Query. */
export const micRecordingUrl = () => "/mic/recording";

export const { useGetMicConfigQuery, useSetMicConfigMutation, useTestMicRecordingMutation, useGetMicServiceStatusQuery, useSetMicServiceActiveMutation } =
  micApi;
