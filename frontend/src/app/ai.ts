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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Is the real AI builder usable right now? */
export const aiReady = (s: RootState) => s.mirror.live && s.modules.aiAvailable;

function mapMsgs(msgs: api.AiMsg[]): ChatMsg[] {
  return msgs
    .filter((m) => (m.text && m.text.trim()) || (m.files && m.files.length))
    .map((m) => ({
      role: m.role === "user" ? "me" : "bot",
      kind: m.role === "sys" ? "status" : undefined,
      // keep chat plain — never expose file names / technical detail
      text: (m.text || "").trim() || "✓",
    }));
}
const asstCount = (msgs: api.AiMsg[]) => msgs.filter((m) => m.role === "assistant").length;

/** Open the workshop on a real draft/installed module: load its session. */
export const openAiWorkshop =
  (name: string, scope: "draft" | "installed" = "draft"): Thunk =>
  async (dispatch) => {
    dispatch(modulesActions.aiOpen({ name, scope }));
    dispatch(nav("workshop", "modules"));
    try {
      const s = await api.aiSession(name, scope);
      dispatch(modulesActions.aiSetSession({ messages: mapMsgs(s.messages), rev: s.rev }));
    } catch (e) {
      dispatch(modulesActions.aiError(String(e)));
    }
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

// one in-flight poll loop at a time; newer sends supersede older ones
let pollToken = 0;

/** Send a message to the agent and poll the session until the turn completes. */
export const aiSend =
  (text?: string): Thunk =>
  async (dispatch, getState) => {
    const m = getState().modules;
    const v = (text ?? m.chatDraft).trim();
    if (!v || m.aiStreaming) return;
    const name = m.workshopMod;
    const scope = m.aiScope;

    // baseline number of assistant replies before this turn
    let baseline = -1;
    try {
      baseline = asstCount((await api.aiSession(name, scope)).messages);
    } catch {
      /* fall back to first poll establishing the baseline */
    }

    dispatch(modulesActions.aiUserSend(v));
    dispatch(uiActions.agentStart({ status: L(getState()).agentWorking, mod: name }));

    try {
      await api.aiChat(name, scope, v); // kicks the agent (runs server-side)
    } catch (e) {
      dispatch(modulesActions.aiError(String(e)));
      dispatch(uiActions.agentDone({ ready: false }));
      return;
    }

    const token = ++pollToken;
    for (let i = 0; i < 120; i++) {
      await sleep(1500);
      if (token !== pollToken) return; // superseded by a newer send
      if (getState().modules.workshopMod !== name) return; // user left this module
      let s: Awaited<ReturnType<typeof api.aiSession>>;
      try {
        s = await api.aiSession(name, scope);
      } catch {
        continue;
      }
      const asst = asstCount(s.messages);
      if (baseline < 0) baseline = asst; // couldn't get baseline → set, catch next turn
      else if (asst > baseline) {
        dispatch(modulesActions.aiSetSession({ messages: mapMsgs(s.messages), rev: s.rev }));
        dispatch(uiActions.agentDone({ ready: getState().ui.screen !== "workshop" }));
        return;
      }
    }
    // timed out
    dispatch(modulesActions.aiError(getState().ui.lang === "en" ? "The agent is taking long — try again." : "Agent běží dlouho — zkus to znovu."));
    dispatch(uiActions.agentDone({ ready: false }));
  };

/** Finalize: install the draft onto the mirror + register it in the catalog. */
export const aiInstall = (): Thunk => async (dispatch, getState) => {
  const name = getState().modules.workshopMod;
  const lab = L(getState());
  dispatch(uiActions.taskStart({ label: `${lab.taskInstall} ${name}`, kind: "install", target: name }));
  // finalize does npm install + pm2 restart (slow) — crawl the bar so it lives
  const crawl = setInterval(() => {
    const p = getState().ui.taskPct;
    dispatch(uiActions.taskProgress(Math.min(92, p + 3 + Math.random() * 6)));
  }, 700);
  try {
    let r = await api.aiFinalize(name, false);
    if (!r.ok && r.exists) r = await api.aiFinalize(name, true); // overwrite a previous attempt
    clearInterval(crawl);
    if (!r.ok) {
      dispatch(uiActions.taskClear());
      dispatch(toast(r.error || lab.tInstalled));
      return;
    }
    dispatch(uiActions.taskProgress(100));
    await dispatch(refreshStoreData());
    dispatch(nav("modules", "modules"));
    setTimeout(() => {
      dispatch(uiActions.taskClear());
      dispatch(toast(lab.tInstalled));
    }, 400);
  } catch (e) {
    clearInterval(crawl);
    dispatch(uiActions.taskClear());
    dispatch(toast(String(e)));
  }
};

export const refreshDrafts = (): Thunk => (dispatch) => {
  api.aiListDrafts().then((d) => dispatch(modulesActions.setServerDrafts(d.drafts || []))).catch(() => {});
};
