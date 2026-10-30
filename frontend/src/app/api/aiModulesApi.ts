import { createApi } from "@reduxjs/toolkit/query/react";
import { mqttBaseQuery } from "@/app/mqttBaseQuery";
import { onTopic } from "@/services/mqttTopicBus";

// Mirrors backend/features/ai_modules/constants.py exactly: flat topics, no
// `rpc` segment, MQTT-only — no JSON HTTP twins exist for this feature (see
// docs/features/ai_modules.md). The one HTTP route it does have
// (/module-draft/<name>, a zip) stays a plain fetch — not an RTK Query
// concern, it's a binary download, not cacheable JSON state.
const BASE = "smartmirror/ai_modules";
const TOPIC = {
  status: `${BASE}/status`,
  list: `${BASE}/list`,
  draftCreate: `${BASE}/draft/create`,
  editOpen: `${BASE}/edit/open`,
  message: `${BASE}/message`,
  session: `${BASE}/session`,
  install: `${BASE}/install`,
  configStart: `${BASE}/config/start`,
  configMessage: `${BASE}/config/message`,
  configEnd: `${BASE}/config/end`,
  stream: `${BASE}/stream`, // + /<scope>/<name>
} as const;

export type AiScope = "draft" | "installed";

export interface AiStatus {
  claudeCli: boolean;
  model?: string;
}
export interface AiDraftSummary {
  name: string;
  description: string;
}
export interface AiMsg {
  role: "user" | "assistant" | "sys";
  text: string;
}
export interface AiSession {
  ok: boolean;
  name: string;
  scope: AiScope;
  description: string;
  messages: AiMsg[];
  error?: string;
}

/** The agent's live token stream — one topic per session, not request/reply.
 * Subscribe directly via the topic bus; this is not an RTK Query endpoint
 * because it's a continuous event feed, not a single cacheable value. */
export interface AiStreamEvent {
  type: "connected" | "text" | "tool" | "error" | "done" | "config";
  text?: string;
  tool?: string;
  file?: string;
  rev?: number;
  touched?: boolean;
  /** type "config" (setup chat only): the agent's current proposal */
  values?: Record<string, unknown>;
  ready?: boolean;
}

/** Catalog entry handed to the setup chat — the agent reads the module's
 * source on its own, this just tells it which module and which keys. */
export interface AiConfigModule {
  type: string;
  module: string;
  label: string;
  fields: { key: string; label: string; required?: boolean; help?: string }[];
}

/** The setup chat streams on stream/config/<chatId> (constants.CONFIG_SCOPE). */
export const onAiConfigStream = (chatId: string, onEvent: (e: AiStreamEvent) => void) =>
  onAiStream("config", chatId, onEvent);

export function onAiStream(scope: AiScope | "config", name: string, onEvent: (e: AiStreamEvent) => void): () => void {
  const topic = `${TOPIC.stream}/${scope}/${name}`;
  return onTopic(topic, (payload) => {
    try {
      onEvent(JSON.parse(payload));
    } catch {
      /* ignore malformed event */
    }
  });
}

/** The working-copy preview zip — the one HTTP route this feature keeps,
 * because MQTT can't carry a directory (see ai_modules/http.py). */
export const aiDraftZipUrl = (name: string) => `/module-draft/${encodeURIComponent(name)}`;

/** The working copy's demo.html, served directly for the Workshop's live
 * <iframe> preview (see ai_modules/daemon.py's static mount). Cache-busted
 * with aiRev so a fresh agent turn (which may have rewritten demo.html)
 * reloads the iframe instead of showing a stale cached copy. */
export const aiPreviewUrl = (name: string, rev: number) =>
  `/module-preview/${encodeURIComponent(name)}/demo.html?rev=${rev}`;

export const aiModulesApi = createApi({
  reducerPath: "aiModulesApi",
  baseQuery: mqttBaseQuery,
  tagTypes: ["AiStatus", "AiDrafts", "AiSession"],
  endpoints: (build) => ({
    getAiStatus: build.query<AiStatus, void>({
      query: () => ({ topic: TOPIC.status }),
      providesTags: ["AiStatus"],
    }),

    listAiDrafts: build.query<AiDraftSummary[], void>({
      query: () => ({ topic: TOPIC.list }),
      transformResponse: (r: { drafts: AiDraftSummary[] }) => r.drafts,
      providesTags: ["AiDrafts"],
    }),

    createAiDraft: build.mutation<{ ok: boolean; name: string; sessionId: number }, { name: string; description: string }>({
      query: (args) => ({ topic: TOPIC.draftCreate, payload: { ...args } }),
      invalidatesTags: ["AiDrafts"],
    }),

    editAiModule: build.mutation<{ ok: boolean; name: string; sessionId: number }, string>({
      query: (name) => ({ topic: TOPIC.editOpen, payload: { name } }),
    }),

    getAiSession: build.query<AiSession, { scope: AiScope; name: string }>({
      query: ({ scope, name }) => ({ topic: TOPIC.session, payload: { scope, name } }),
      providesTags: (_r, _e, { name }) => [{ type: "AiSession", id: name }],
    }),

    sendAiMessage: build.mutation<{ ok: boolean; error?: string }, { scope: AiScope; name: string; message: string }>({
      query: (args) => ({ topic: TOPIC.message, payload: { ...args } }),
      // The reply is just "started" — the actual turn streams over
      // onAiStream(). Invalidate the session so the next getAiSession
      // (e.g. on reopen) includes the new messages once they land.
      invalidatesTags: (_r, _e, { name }) => [{ type: "AiSession", id: name }],
    }),

    installAiModule: build.mutation<{ ok: boolean; installedTo?: string; error?: string }, { scope: AiScope; name: string; overwrite?: boolean }>({
      query: (args) => ({ topic: TOPIC.install, payload: { ...args } }),
      invalidatesTags: ["AiDrafts", "AiStatus"],
    }),

    startAiConfig: build.mutation<{ ok: boolean; error?: string }, { chatId: string; module: AiConfigModule }>({
      query: (args) => ({ topic: TOPIC.configStart, payload: { ...args } }),
    }),

    sendAiConfigMessage: build.mutation<{ ok: boolean; error?: string }, { chatId: string; message: string }>({
      query: (args) => ({ topic: TOPIC.configMessage, payload: { ...args } }),
    }),

    endAiConfig: build.mutation<{ ok: boolean }, string>({
      query: (chatId) => ({ topic: TOPIC.configEnd, payload: { chatId } }),
    }),
  }),
});

export const {
  useGetAiStatusQuery,
  useListAiDraftsQuery,
  useCreateAiDraftMutation,
  useEditAiModuleMutation,
  useGetAiSessionQuery,
  useSendAiMessageMutation,
  useInstallAiModuleMutation,
} = aiModulesApi;
