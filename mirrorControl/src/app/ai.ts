import type { AppDispatch, RootState } from "./store";
import { modulesActions } from "@/features/modules/modulesSlice";
import { uiActions } from "@/features/ui/uiSlice";
import { LABELS } from "@/i18n/labels";
import * as api from "@/services/api";
import type { ChatMsg } from "@/types";
import { toast, nav } from "./thunks";
import { refreshStoreData } from "./connect";

type Thunk = (dispatch: AppDispatch, getState: () => RootState) => void;
const L = (s: RootState) => LABELS[s.ui.lang] as Record<string, string>;

/** Is the real AI builder usable right now? */
export const aiReady = (s: RootState) => s.mirror.live && s.modules.aiAvailable;

function mapMsgs(msgs: api.AiMsg[]): ChatMsg[] {
  return msgs
    .filter((m) => (m.text && m.text.trim()) || (m.files && m.files.length))
    .map((m) => ({
      role: m.role === "user" ? "me" : "bot",
      kind: m.role === "sys" ? "status" : undefined,
      text: (m.text || "").trim() + (m.files && m.files.length ? `\n— ${m.files.join(", ")}` : ""),
    }));
}

// --- single live SSE stream ---
let es: EventSource | null = null;
let esKey = "";

function openStream(name: string, scope: "draft" | "installed", dispatch: AppDispatch, getState: () => RootState) {
  const key = `${scope}/${name}`;
  if (es && esKey === key) return;
  closeAiStream();
  esKey = key;
  es = api.aiStream(name, scope, (ev) => {
    if (ev.type === "text" && ev.text) {
      dispatch(modulesActions.aiAppendText(ev.text));
    } else if (ev.type === "error") {
      dispatch(modulesActions.aiError(ev.text || "error"));
      dispatch(uiActions.agentDone({ ready: false }));
    } else if (ev.type === "done") {
      dispatch(modulesActions.aiStreamDone({ rev: ev.rev || 0 }));
      dispatch(uiActions.agentDone({ ready: getState().ui.screen !== "workshop" }));
    }
    // "connected" / "tool": no visible change
  });
}

export function closeAiStream(): void {
  if (es) {
    es.close();
    es = null;
    esKey = "";
  }
}

/** Open the workshop on a real draft/installed module: load session + stream. */
export const openAiWorkshop =
  (name: string, scope: "draft" | "installed" = "draft"): Thunk =>
  async (dispatch, getState) => {
    dispatch(modulesActions.aiOpen({ name, scope }));
    dispatch(nav("workshop", "modules"));
    try {
      const s = await api.aiSession(name, scope);
      dispatch(modulesActions.aiSetSession({ messages: mapMsgs(s.messages), rev: s.rev }));
    } catch (e) {
      dispatch(modulesActions.aiError(String(e)));
    }
    openStream(name, scope, dispatch, getState);
  };

/** Create a real scaffolded draft from the create form, then open it. */
export const aiCreateAndOpen = (): Thunk => async (dispatch, getState) => {
  const m = getState().modules;
  const name = m.createName.trim();
  if (!name) return;
  try {
    const r = await api.aiCreateDraft(name, m.createDesc.trim());
    dispatch(modulesActions.resetCreate());
    api.aiListDrafts().then((d) => dispatch(modulesActions.setServerDrafts(d.drafts || []))).catch(() => {});
    dispatch(openAiWorkshop(r.name, "draft"));
  } catch (e) {
    dispatch(toast(String(e)));
  }
};

/** Send a chat message to the agent; the reply streams in over SSE. */
export const aiSend =
  (text?: string): Thunk =>
  async (dispatch, getState) => {
    const m = getState().modules;
    const v = (text ?? m.chatDraft).trim();
    if (!v || m.aiStreaming) return;
    dispatch(modulesActions.aiUserSend(v));
    dispatch(uiActions.agentStart({ status: L(getState()).agentWorking, mod: m.workshopMod }));
    openStream(m.workshopMod, m.aiScope, dispatch, getState);
    try {
      await api.aiChat(m.workshopMod, m.aiScope, v);
    } catch (e) {
      dispatch(modulesActions.aiError(String(e)));
      dispatch(uiActions.agentDone({ ready: false }));
    }
  };

/** Finalize: install the draft onto the mirror + register it in the catalog. */
export const aiInstall = (): Thunk => async (dispatch, getState) => {
  const name = getState().modules.workshopMod;
  const lab = L(getState());
  dispatch(uiActions.taskStart({ label: `${lab.taskInstall} ${name}`, kind: "install", target: name }));
  try {
    const r = await api.aiFinalize(name, false);
    if (!r.ok) {
      dispatch(uiActions.taskClear());
      dispatch(toast(r.error || lab.tInstalled));
      return;
    }
    dispatch(uiActions.taskProgress(100));
    await dispatch(refreshStoreData());
    closeAiStream();
    dispatch(nav("modules", "modules"));
    setTimeout(() => {
      dispatch(uiActions.taskClear());
      dispatch(toast(lab.tInstalled));
    }, 400);
  } catch (e) {
    dispatch(uiActions.taskClear());
    dispatch(toast(String(e)));
  }
};

export const refreshDrafts = (): Thunk => (dispatch) => {
  api.aiListDrafts().then((d) => dispatch(modulesActions.setServerDrafts(d.drafts || []))).catch(() => {});
};
