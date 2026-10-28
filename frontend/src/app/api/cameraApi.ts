import { createApi } from "@reduxjs/toolkit/query/react";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";
import { onTopicJson } from "@/services/mqttTopicBus";

// Mirrors backend/features/camera/constants.py's RPC_* / MODE / STATE /
// PROFILES exactly — kept in sync by hand, since the frontend cannot import
// the Python module.
const RPC = "smartmirror/camera/rpc";
const TOPIC = {
  rpcHealth: `${RPC}/health`,
  rpcModeGet: `${RPC}/mode/get`,
  rpcModeSet: `${RPC}/mode/set`,
  rpcSettings: `${RPC}/settings`,
  rpcDatasetList: `${RPC}/dataset/list`,
  rpcDatasetDelete: `${RPC}/dataset/delete`,
  rpcCapture: `${RPC}/capture`,
  rpcEncode: `${RPC}/encode`,
  rpcProfilesList: `${RPC}/profiles/list`,
  rpcProfilesDelete: `${RPC}/profiles/delete`,
  state: "smartmirror/camera/state", // retained
  profiles: "smartmirror/camera/profiles", // retained
} as const;

export interface CameraHealth {
  mode: string;
  modes: string[];
  camera_open: boolean;
  daemon_active: boolean;
  fps: number;
  width: number;
  height: number;
  detected_face: string | null;
  finger_count: number | null;
  controls: CameraControls;
}

export interface CameraControls {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  auto_exposure: boolean;
  exposure_time_us: number | null;
  exposure_value: number;
  auto_white_balance: boolean;
  awb_mode: string;
  analogue_gain: number | null;
  noise_reduction: string;
}

export interface CameraSettingsInput extends Partial<CameraControls> {
  width?: number;
  height?: number;
}

export interface CameraProfile {
  name: string;
  count: number;
  sample: string | null;
  is_default: boolean;
}

export const cameraApi = createApi({
  reducerPath: "cameraApi",
  baseQuery: mqttBaseQuery,
  tagTypes: ["CameraHealth", "CameraProfiles", "Dataset"],
  endpoints: (build) => ({
    // ---- health/state: RPC read, kept fresh by the retained STATE topic ---- //
    getCameraHealth: build.query<CameraHealth, void>({
      query: () => ({ topic: TOPIC.rpcHealth }),
      providesTags: ["CameraHealth"],
      // The backend pushes a retained `camera/state` message on every mode/
      // control change — subscribe once per cache entry instead of
      // RPC-polling for it (see CLAUDE.md "State is pushed retained").
      async onCacheEntryAdded(_arg, { cacheDataLoaded, cacheEntryRemoved, updateCachedData }) {
        await cacheDataLoaded;
        const unsub = onTopicJson<CameraHealth>(TOPIC.state, (data) => {
          updateCachedData(() => data);
        });
        await cacheEntryRemoved;
        unsub();
      },
    }),

    setCameraMode: build.mutation<CameraHealth, string>({
      query: (mode) => ({ topic: TOPIC.rpcModeSet, payload: { mode } }),
      invalidatesTags: ["CameraHealth"],
    }),

    setCameraSettings: build.mutation<CameraHealth, CameraSettingsInput>({
      query: (settings) => ({ topic: TOPIC.rpcSettings, payload: { ...settings } }),
      invalidatesTags: ["CameraHealth"],
    }),

    // ---- profiles ---- //
    getCameraProfiles: build.query<CameraProfile[], void>({
      query: () => ({ topic: TOPIC.rpcProfilesList }),
      transformResponse: (r: { profiles: CameraProfile[] }) => r.profiles,
      providesTags: ["CameraProfiles"],
      async onCacheEntryAdded(_arg, { cacheDataLoaded, cacheEntryRemoved, updateCachedData }) {
        await cacheDataLoaded;
        const unsub = onTopicJson<{ profiles: CameraProfile[] }>(TOPIC.profiles, (data) => {
          updateCachedData(() => data.profiles);
        });
        await cacheEntryRemoved;
        unsub();
      },
    }),

    deleteCameraProfile: build.mutation<{ removed: string }, string>({
      query: (name) => ({ topic: TOPIC.rpcProfilesDelete, payload: { name } }),
      invalidatesTags: ["CameraProfiles"],
    }),

    // ---- dataset (training photos for one profile) ---- //
    listDataset: build.query<string[], string>({
      query: (name) => ({ topic: TOPIC.rpcDatasetList, payload: { name } }),
      transformResponse: (r: { photos: string[] }) => r.photos,
      providesTags: (_r, _e, name) => [{ type: "Dataset", id: name }],
    }),

    deleteDatasetPhoto: build.mutation<string[], { name: string; file: string }>({
      query: ({ name, file }) => ({ topic: TOPIC.rpcDatasetDelete, payload: { name, file } }),
      transformResponse: (r: { photos: string[] }) => r.photos,
      invalidatesTags: (_r, _e, { name }) => [{ type: "Dataset", id: name }],
    }),

    capturePhoto: build.mutation<{ file: string; total: number }, { name: string; file?: string }>({
      query: (args) => ({ topic: TOPIC.rpcCapture, payload: args }),
      invalidatesTags: (_r, _e, { name }) => [{ type: "Dataset", id: name }],
    }),

    encodeFaces: build.mutation<{ ok: boolean; output: string; error: string | null }, string | null>({
      query: (name) => ({ topic: TOPIC.rpcEncode, payload: { name } }),
      invalidatesTags: ["CameraProfiles"],
    }),
  }),
});

export const {
  useGetCameraHealthQuery,
  useSetCameraModeMutation,
  useSetCameraSettingsMutation,
  useGetCameraProfilesQuery,
  useDeleteCameraProfileMutation,
  useListDatasetQuery,
  useDeleteDatasetPhotoMutation,
  useCapturePhotoMutation,
  useEncodeFacesMutation,
} = cameraApi;
