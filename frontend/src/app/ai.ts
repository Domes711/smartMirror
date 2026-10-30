import type { AppDispatch, RootState } from "./store";
import { modulesActions } from "@/features/modules/modulesSlice";
import { uiActions } from "@/features/ui/uiSlice";
import { LABELS } from "@/i18n/labels";
import type { ChatMsg } from "@/types";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { scenesApi } from "@/app/api/scenesApi";
import { aiModulesApi, onAiConfigStream, onAiStream } from "@/app/api/aiModulesApi";
import type { AiMsg } from "@/app/api/aiModulesApi";
import { nav } from "./thunks";

type Thunk = (dispatch: AppDispatch, getState: () => RootState) => void;
const L = (s: RootState) => LABELS[s.ui.lang] as Record<string, string>;

/** Is the real AI builder usable right now? */
export const aiReady = (s: RootState) => s.modules.aiAvailable;

function mapMsgs(msgs: AiMsg[]): ChatMsg[] {
  return msgs
    .filter((m) => m.text && m.text.trim())
    .map((m) => ({
      role: m.role === "user" ? "me" : "bot",
      kind: m.role === "sys" ? "status" : undefined,
      text: (m.text || "").trim() || "✓",
    }));
}

/** Open the workshop on an existing draft: load its session. */
export const openAiWorkshop =
  (name: string): Thunk =>
  async (dispatch) => {
    dispatch(modulesActions.aiOpen({ name, scope: "draft" }));
    dispatch(nav("workshop", "modules"));
    try {
      const s = await dispatch(aiModulesApi.endpoints.getAiSession.initiate({ scope: "draft", name })).unwrap();
      dispatch(modulesActions.aiSetSession({ messages: mapMsgs(s.messages), rev: 1 }));
    } catch (e) {
      dispatch(modulesActions.aiError(String(e)));
    }
  };

/** Start/resume editing an installed module: backend copies it into a
 * working-copy draft (service.py's edit_open), then open the workshop on it. */
export const openAiEdit =
  (name: string): Thunk =>
  async (dispatch) => {
    dispatch(modulesActions.aiOpen({ name, scope: "draft" }));
    dispatch(nav("workshop", "modules"));
    try {
      await dispatch(aiModulesApi.endpoints.editAiModule.initiate(name)).unwrap();
      const s = await dispatch(aiModulesApi.endpoints.getAiSession.initiate({ scope: "draft", name })).unwrap();
      dispatch(modulesActions.aiSetSession({ messages: mapMsgs(s.messages), rev: 1 }));
    } catch (e) {
      dispatch(modulesActions.aiError(String(e)));
    }
  };

/** Create a real scaffolded draft from the create form, open it, then kick
 * off the agent's first turn with the user's description — draft_create()
 * only writes the static scaffold, it never calls the agent itself. */
export const aiCreateAndOpen = (): Thunk => async (dispatch, getState) => {
  const m = getState().modules;
  const name = m.createName.trim();
  const description = m.createDesc.trim();
  if (!name) return;
  try {
    const r = await dispatch(aiModulesApi.endpoints.createAiDraft.initiate({ name, description })).unwrap();
    dispatch(modulesActions.resetCreate());
    dispatch(modulesActions.aiOpen({ name: r.name, scope: "draft" }));
    dispatch(nav("workshop", "modules"));
    const s = await dispatch(aiModulesApi.endpoints.getAiSession.initiate({ scope: "draft", name: r.name })).unwrap();
    dispatch(modulesActions.aiSetSession({ messages: mapMsgs(s.messages), rev: 1 }));
    if (description) dispatch(aiSend(description));
  } catch (e) {
    dispatch(modulesActions.aiError(String(e)));
  }
};

// one in-flight stream at a time; a newer send supersedes an older one
let streamToken = 0;
let unsubStream: (() => void) | undefined;

/** Send a message to the agent; the reply streams over onAiStream (MQTT). */
export const aiSend =
  (text?: string): Thunk =>
  async (dispatch, getState) => {
    const m = getState().modules;
    const v = (text ?? m.chatDraft).trim();
    if (!v || m.aiStreaming) return;
    const name = m.workshopMod;
    const scope = m.aiScope;

    dispatch(modulesActions.aiUserSend(v));
    dispatch(uiActions.agentStart({ status: L(getState()).agentWorking, mod: name }));

    unsubStream?.();
    const token = ++streamToken;
    unsubStream = onAiStream(scope, name, (ev) => {
      if (token !== streamToken) return;
      if (ev.type === "text" && ev.text) dispatch(modulesActions.aiAppendText(ev.text));
      else if (ev.type === "done") dispatch(modulesActions.aiStreamDone({ rev: ev.rev || 0 }));
      else if (ev.type === "error") dispatch(modulesActions.aiError(ev.text || "error"));
    });

    try {
      await dispatch(aiModulesApi.endpoints.sendAiMessage.initiate({ scope, name, message: v })).unwrap();
    } catch (e) {
      dispatch(modulesActions.aiError(String(e)));
      dispatch(uiActions.agentDone({ ready: false }));
    }
  };

/** Finalize: install the draft onto the mirror + register it in the catalog. */
export const aiInstall = (): Thunk => async (dispatch, getState) => {
  const name = getState().modules.workshopMod;
  const scope = getState().modules.aiScope;
  const lab = L(getState());
  dispatch(uiActions.taskStart({ label: `${lab.taskInstall} ${name}`, kind: "install", target: name }));
  const crawl = setInterval(() => {
    const p = getState().ui.taskPct;
    dispatch(uiActions.taskProgress(Math.min(92, p + 3 + Math.random() * 6)));
  }, 700);
  try {
    const r = await dispatch(aiModulesApi.endpoints.installAiModule.initiate({ scope, name, overwrite: true })).unwrap();
    clearInterval(crawl);
    if (!r.ok) {
      dispatch(uiActions.taskClear());
      dispatch(modulesActions.aiError(r.error || lab.tInstalled));
      return;
    }
    dispatch(uiActions.taskProgress(100));
    setTimeout(() => {
      dispatch(uiActions.taskClear());
      dispatch(nav("modules", "modules"));
    }, 400);
  } catch (e) {
    clearInterval(crawl);
    dispatch(uiActions.taskClear());
    dispatch(modulesActions.aiError(String(e)));
  }
};

// --- setup chat: the agent collects a new instance's config instead of the form ---
let unsubCfgStream: (() => void) | undefined;

/** Open a setup chat for the module in the config modal and let the agent
 * open the conversation. Its replies + config proposals arrive over MQTT. */
export const cfgAiStart = (): Thunk => async (dispatch, getState) => {
  const type = getState().scenes.cfgType;
  const entry = scenesApi.endpoints.getScenesModules.select()(getState()).data?.catalog.find((c) => c.type === type);
  if (!type || !entry || getState().scenes.cfgChatId) return; // already running
  const chatId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  dispatch(scenesActions.cfgChatStart(chatId));

  unsubCfgStream?.();
  unsubCfgStream = onAiConfigStream(chatId, (ev) => {
    if (getState().scenes.cfgChatId !== chatId) return; // modal closed / restarted
    if (ev.type === "text" && ev.text) dispatch(scenesActions.cfgBotText(ev.text));
    else if (ev.type === "config" && ev.values) dispatch(scenesActions.cfgProposal({ values: ev.values, ready: !!ev.ready }));
    else if (ev.type === "done") dispatch(scenesActions.cfgTurnDone());
    else if (ev.type === "error") dispatch(scenesActions.cfgChatError(ev.text || "error"));
  });

  const module = {
    type: entry.type,
    module: entry.module,
    label: entry.label,
    fields: (entry.fields || []).map((f) => ({ key: f.key, label: f.label, required: f.required, help: f.help })),
  };
  try {
    const r = await dispatch(aiModulesApi.endpoints.startAiConfig.initiate({ chatId, module })).unwrap();
    if (!r.ok) dispatch(scenesActions.cfgChatError(r.error || "error"));
  } catch (e) {
    dispatch(scenesActions.cfgChatError(String((e as { message?: string })?.message || e)));
  }
};

export const cfgAiSend =
  (text?: string): Thunk =>
  async (dispatch, getState) => {
    const s = getState().scenes;
    const v = (text ?? s.cfgChatDraft).trim();
    if (!v || s.cfgBusy || !s.cfgChatId) return;
    dispatch(scenesActions.cfgUserSend(v));
    try {
      const r = await dispatch(aiModulesApi.endpoints.sendAiConfigMessage.initiate({ chatId: s.cfgChatId, message: v })).unwrap();
      if (!r.ok) dispatch(scenesActions.cfgChatError(r.error || "error"));
    } catch (e) {
      dispatch(scenesActions.cfgChatError(String((e as { message?: string })?.message || e)));
    }
  };

/** Drop the setup chat (server-side memory + our stream subscription). */
export const cfgAiEnd = (): Thunk => (dispatch, getState) => {
  const chatId = getState().scenes.cfgChatId;
  unsubCfgStream?.();
  unsubCfgStream = undefined;
  if (chatId) dispatch(aiModulesApi.endpoints.endAiConfig.initiate(chatId));
};
