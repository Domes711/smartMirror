import { createApi } from "@reduxjs/toolkit/query/react";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";
import { onTopicJson } from "@/services/mqttTopicBus";

// Mirrors backend/features/camera/constants.py's RPC_* / MODE / STATE /
// PROFILES exactly — kept in sync by hand, since the frontend cannot import
// the Python module.
export const CAMERA_ENCODE_STATUS_TOPIC = "smartmirror/camera/encode/status"; // retained

const RPC = "smartmirror/camera/rpc";
const TOPIC = {
  rpcHealth: `${RPC}/health`,
  rpcModeGet: `${RPC}/mode/get`,
  rpcModeSet: `${RPC}/mode/set`,
  rpcModeRenew: `${RPC}/mode/renew`,
  rpcModeRelease: `${RPC}/mode/release`,
  rpcSettings: `${RPC}/settings`,
  rpcDatasetList: `${RPC}/dataset/list`,
  rpcDatasetDelete: `${RPC}/dataset/delete`,
  rpcCapture: `${RPC}/capture`,
  rpcEncode: `${RPC}/encode`,
  rpcProfilesList: `${RPC}/profiles/list`,
  rpcProfilesDelete: `${RPC}/profiles/delete`,
  state: "smartmirror/camera/state", // retained
  profiles: "smartmirror/camera/profiles", // retained
  encodeStatus: CAMERA_ENCODE_STATUS_TOPIC,
} as const;

// "idle" (no detection) / "face" / "gesture" are also the production
// presence-driven modes now — GLOBAL_PRESENCE drives them automatically
// (present -> face for a 5s window -> gesture if nobody's recognized, a
// match stops detection and returns to idle, absent always returns to
// idle). "learn" is enrollment-only, not offered as a manual choice here.
export type CameraMode = "idle" | "face" | "gesture" | "learn";

export interface CameraHealth {
  mode: CameraMode;
  modes: CameraMode[];
  camera_open: boolean;
  fps: number;
  target_fps: number;
  width: number;
  height: number;
  tolerance: number;
  // false while a manual dev-console mode choice (setCameraMode) is
  // overriding the presence state machine — see useSetCameraModeMutation's
  // renew/release dance below.
  presence_driven: boolean;
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
  framerate?: number;
  recognition_tolerance?: number;
}

export interface CameraProfile {
  name: string;
  count: number;
  sample: string | null;
  is_default: boolean;
}

export interface EncodeStatus {
  status: "running" | "done" | "error";
  ok?: boolean;
  output?: string;
  error?: string | null;
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

    // A manual dev-console choice — overrides the presence state machine
    // for a while (backend/features/camera/mode_controller.py's
    // MANUAL_OVERRIDE_S). Call renewCameraMode periodically while the dev
    // screen stays open, and releaseCameraMode on unmount — see Radar.tsx's
    // identical stream opt-in/renew/release pattern for the live targets.
    setCameraMode: build.mutation<CameraHealth, CameraMode>({
      query: (mode) => ({ topic: TOPIC.rpcModeSet, payload: { mode } }),
      invalidatesTags: ["CameraHealth"],
    }),

    renewCameraMode: build.mutation<CameraHealth, void>({
      query: () => ({ topic: TOPIC.rpcModeRenew }),
    }),

    releaseCameraMode: build.mutation<CameraHealth, void>({
      query: () => ({ topic: TOPIC.rpcModeRelease }),
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

    // Fire-and-forget: the backend runs the HOG face encoder on a background
    // thread (tens of seconds for more than a handful of photos on a Pi) and
    // replies immediately with {started: true}. The real result comes on
    // ENCODE_STATUS (retained) — see getEncodeStatus below — not on this
    // mutation's own response, so no RPC timeout can misreport it as failed.
    encodeFaces: build.mutation<{ started: boolean }, string | null>({
      query: (name) => ({ topic: TOPIC.rpcEncode, payload: { name } }),
    }),

    // Subscribes to the retained ENCODE_STATUS topic encodeFaces's
    // background thread publishes to ("running" immediately, then "done"/
    // "error" once the encoder finishes). Call forceRefetch false — this
    // never issues its own RPC, it just opens the subscription.
    getEncodeStatus: build.query<EncodeStatus, void>({
      queryFn: () => ({ data: { status: "running" } as EncodeStatus }),
      async onCacheEntryAdded(_arg, { cacheDataLoaded, cacheEntryRemoved, updateCachedData, dispatch }) {
        await cacheDataLoaded;
        const unsub = onTopicJson<EncodeStatus>(TOPIC.encodeStatus, (data) => {
          updateCachedData(() => data);
          // A completed encode means the photo/profile dataset changed —
          // refresh the profile list (counts, sample thumbnail) now rather
          // than waiting for something unrelated to invalidate it.
          if (data.status === "done") dispatch(cameraApi.util.invalidateTags(["CameraProfiles"]));
        });
        await cacheEntryRemoved;
        unsub();
      },
    }),
  }),
});

export const {
  useGetCameraHealthQuery,
  useSetCameraModeMutation,
  useRenewCameraModeMutation,
  useReleaseCameraModeMutation,
  useSetCameraSettingsMutation,
  useGetCameraProfilesQuery,
  useDeleteCameraProfileMutation,
  useListDatasetQuery,
  useDeleteDatasetPhotoMutation,
  useCapturePhotoMutation,
  useEncodeFacesMutation,
  useGetEncodeStatusQuery,
} = cameraApi;
