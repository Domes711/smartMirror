import { createApi } from "@reduxjs/toolkit/query/react";
import type { BaseQueryFn } from "@reduxjs/toolkit/query";
import { publish } from "@/services/mqtt";
import { onTopicJson } from "@/services/mqttTopicBus";

/**
 * Display does NOT speak the `_rid`/`_reply` RPC pattern the other features
 * use — backend/features/display/mqtt.py's `on_message()` dispatches on
 * plain `smartmirror/display/control/<name>` sub-topics with bare payloads
 * ("on", "50", …), then always republishes the full retained STATE. So its
 * baseQuery is a plain publish, not an RPC round trip — see
 * backend/README.md's display section for why (predates the RPC convention).
 */
const BASE = "smartmirror/display";
const TOPIC = {
  state: `${BASE}/state`, // retained
  power: `${BASE}/control/power`, // "on" | "standby"
  brightness: `${BASE}/control/brightness`, // "0".."100"
  contrast: `${BASE}/control/contrast`,
  rgb: `${BASE}/control/rgb`, // JSON {r,g,b}
  preset: `${BASE}/control/preset`,
  mode: `${BASE}/control/mode`,
  e2: `${BASE}/control/e2`,
  getState: `${BASE}/control/get_state`, // in: publish STATE now
} as const;

export interface DisplayState {
  brightness: number | null;
  contrast: number | null;
  red: number | null;
  green: number | null;
  blue: number | null;
  power: number | null; // VCP D6: 1 = on, 4 = standby
  timestamp: number;
}

interface DisplayQueryArgs {
  op: "getState" | "setPower" | "setBrightness" | "setContrast" | "setRgb" | "setPreset" | "setMode" | "setE2";
  value?: string | number | { r?: number; g?: number; b?: number };
}

const displayBaseQuery: BaseQueryFn<DisplayQueryArgs, unknown, { message: string }> = async ({ op, value }) => {
  switch (op) {
    case "getState":
      publish(TOPIC.getState, "1");
      break;
    case "setPower":
      publish(TOPIC.power, String(value));
      break;
    case "setBrightness":
      publish(TOPIC.brightness, String(value));
      break;
    case "setContrast":
      publish(TOPIC.contrast, String(value));
      break;
    case "setRgb":
      publish(TOPIC.rgb, value);
      break;
    case "setPreset":
      publish(TOPIC.preset, String(value));
      break;
    case "setMode":
      publish(TOPIC.mode, String(value));
      break;
    case "setE2":
      publish(TOPIC.e2, String(value));
      break;
  }
  // Fire-and-forget by design (no _rid/_reply on this feature) — the
  // mutation "succeeds" immediately; the real confirmation is the retained
  // STATE push the onCacheEntryAdded subscription below picks up.
  return { data: { ok: true } };
};

export const displayApi = createApi({
  reducerPath: "displayApi",
  baseQuery: displayBaseQuery,
  tagTypes: ["DisplayState"],
  endpoints: (build) => ({
    getDisplayState: build.query<DisplayState, void>({
      query: () => ({ op: "getState" }),
      providesTags: ["DisplayState"],
      async onCacheEntryAdded(_arg, { cacheDataLoaded, cacheEntryRemoved, updateCachedData }) {
        await cacheDataLoaded;
        const unsub = onTopicJson<DisplayState>(TOPIC.state, (data) => {
          updateCachedData(() => data);
        });
        await cacheEntryRemoved;
        unsub();
      },
      // getState's "response" is just an ack — the real data arrives via
      // the retained STATE push, so an empty initial value is fine; the
      // subscription above fills it in the moment the daemon answers.
      transformResponse: (): DisplayState => ({
        brightness: null,
        contrast: null,
        red: null,
        green: null,
        blue: null,
        power: null,
        timestamp: 0,
      }),
    }),

    setDisplayPower: build.mutation<{ ok: boolean }, "on" | "standby">({
      query: (mode) => ({ op: "setPower", value: mode }),
    }),
    setDisplayBrightness: build.mutation<{ ok: boolean }, number>({
      query: (value) => ({ op: "setBrightness", value }),
    }),
    setDisplayContrast: build.mutation<{ ok: boolean }, number>({
      query: (value) => ({ op: "setContrast", value }),
    }),
    setDisplayRgb: build.mutation<{ ok: boolean }, { r?: number; g?: number; b?: number }>({
      query: (value) => ({ op: "setRgb", value }),
    }),
    setDisplayPreset: build.mutation<{ ok: boolean }, string>({
      query: (value) => ({ op: "setPreset", value }),
    }),
    setDisplayMode: build.mutation<{ ok: boolean }, string>({
      query: (value) => ({ op: "setMode", value }),
    }),
    setDisplayE2: build.mutation<{ ok: boolean }, number>({
      query: (value) => ({ op: "setE2", value }),
    }),
  }),
});

export const {
  useGetDisplayStateQuery,
  useSetDisplayPowerMutation,
  useSetDisplayBrightnessMutation,
  useSetDisplayContrastMutation,
  useSetDisplayRgbMutation,
  useSetDisplayPresetMutation,
  useSetDisplayModeMutation,
  useSetDisplayE2Mutation,
} = displayApi;
