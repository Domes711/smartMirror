import type { AppDispatch, RootState } from "./store";
import { uiActions, groupOf } from "@/features/ui/uiSlice";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { modulesActions } from "@/features/modules/modulesSlice";
import { profilesActions } from "@/features/profiles/profilesSlice";
import { devActions } from "@/features/dev/devSlice";
import { LABELS } from "@/i18n/labels";
import type { Draft, Scene, ScreenId, TabGroup, TaskKind } from "@/types";
import { publish, TOPICS } from "@/services/mqtt";
import { STORE } from "@/data/catalog";
import * as api from "@/services/api";
import { refreshStoreData, loadProfileLive, scenesToStore, regionsToEntries } from "@/app/connect";
import { mirrorActions } from "@/features/mirror/mirrorSlice";
import { resolveActiveId } from "@/app/selectors";

type Thunk = (dispatch: AppDispatch, getState: () => RootState) => void;

const Lof = (s: RootState) => LABELS[s.ui.lang] as Record<string, string>;
const en = (s: RootState) => s.ui.lang === "en";

// --- module-level timers (single in-flight each) ---
let toastT: ReturnType<typeof setTimeout> | undefined;
let liveT: ReturnType<typeof setTimeout> | undefined;
let taskInt: ReturnType<typeof setInterval> | undefined;
let taskDoneT: ReturnType<typeof setTimeout> | undefined;
let agentTimers: ReturnType<typeof setTimeout>[] = [];
let scanInt: ReturnType<typeof setInterval> | undefined;
let scanTo: ReturnType<typeof setTimeout> | undefined;
let titleClicks = 0;
let titleResetT: ReturnType<typeof setTimeout> | undefined;

export const toast =
  (msg: string): Thunk =>
  (dispatch) => {
    dispatch(uiActions.setToast(msg));
    clearTimeout(toastT);
    toastT = setTimeout(() => dispatch(uiActions.setToast("")), 1700);
  };

export const startLiveLoad = (): Thunk => (dispatch) => {
  clearTimeout(liveT);
  dispatch(uiActions.setHomeLoading(true));
  liveT = setTimeout(() => dispatch(uiActions.setHomeLoading(false)), 1900);
};

export const tickClock = (): Thunk => (dispatch) => {
  const d = new Date();
  dispatch(uiActions.setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`));
};

export const nav =
  (screen: ScreenId, tab?: TabGroup | null): Thunk =>
  (dispatch) => {
    dispatch(uiActions.navTo({ screen, tab }));
    if (screen === "home") dispatch(startLiveLoad());
  };

export const goTab =
  (g: TabGroup): Thunk =>
  (dispatch, getState) => {
    dispatch(uiActions.goTab(g));
    if (getState().ui.screen === "home") dispatch(startLiveLoad());
  };

export const editScene =
  (id: string, ret: string): Thunk =>
  (dispatch) => {
    const tab: TabGroup = ret === "windows" || ret === "home" ? "home" : ret === "profile" ? "profiles" : "scenes";
    dispatch(scenesActions.startEdit({ id, editReturn: ret }));
    dispatch(uiActions.setScreenTab({ screen: "editor", tab }));
  };

/** editScene for the currently-resolved scene (Home "Edit scene" button). */
export const editResolved =
  (ret: string): Thunk =>
  (dispatch, getState) => {
    const s = getState().scenes;
    const resolved = resolveActiveId(s.scenes) || s.activeScene;
    dispatch(editScene(resolved, ret));
  };

export const editBack = (): Thunk => (dispatch, getState) => {
  const s = getState().scenes;
  const cur = JSON.stringify((s.editing && s.scenes[s.editing]?.regions) || {});
  if (cur !== s.editSnap) {
    dispatch(scenesActions.openEditBack());
    return;
  }
  dispatch(nav(s.editReturn as ScreenId, groupOf(s.editReturn as ScreenId)));
};

const notConnected = (s: RootState) => (en(s) ? "Mirror not connected — not applied" : "Zrcadlo nepřipojeno — neaplikováno");

export const saveSceneAndBack = (): Thunk => (dispatch, getState) => {
  if (getState().mirror.live) dispatch(pushLayoutLive()); // toasts apply result
  else dispatch(toast(notConnected(getState())));
  const s = getState().scenes;
  dispatch(nav(s.editReturn as ScreenId, groupOf(s.editReturn as ScreenId)));
};

export const discardAndBack = (): Thunk => (dispatch, getState) => {
  dispatch(scenesActions.discardEdit());
  const s = getState().scenes;
  dispatch(nav(s.editReturn as ScreenId, groupOf(s.editReturn as ScreenId)));
};

export const confirmDelScene = (): Thunk => (dispatch, getState) => {
  dispatch(scenesActions.confirmDelScene());
  if (getState().mirror.live) dispatch(pushLayoutLive()); // persist + apply
  else dispatch(toast(Lof(getState()).tSceneDel));
  dispatch(nav("scenes", "scenes"));
};

/** Region-plus: place held / move selected, with the right toast. */
export const regionPlus =
  (rid: import("@/types").RegionId): Thunk =>
  (dispatch, getState) => {
    const s = getState().scenes;
    if (!s.picked && !s.selChip) {
      dispatch(toast(Lof(getState()).tSelect));
      return;
    }
    const moving = !!s.selChip && !s.picked;
    dispatch(scenesActions.placeAt(rid));
    dispatch(toast(moving ? Lof(getState()).tMoved : Lof(getState()).tAdded));
  };

export const addModToZone =
  (rid: import("@/types").RegionId, mod: string): Thunk =>
  (dispatch, getState) => {
    dispatch(scenesActions.addModToZone({ rid, mod }));
    dispatch(toast(Lof(getState()).tAdded));
  };

export const removeModFromScene =
  (mod: string): Thunk =>
  (dispatch, getState) => {
    dispatch(scenesActions.removeModFromScene(mod));
    dispatch(toast(Lof(getState()).tRemovedScene));
  };

// --- scene creation ---
const nsBusy = (s: RootState) => {
  const isDef = (id: string) => /^default/i.test(s.scenes.scenes[id].use || "");
  const b: [number, number][] = [];
  for (const id of Object.keys(s.scenes.scenes)) {
    const sc = s.scenes.scenes[id];
    if (!sc.scheduled || isDef(id)) continue;
    b.push([sc.startH ?? 0, sc.endH ?? 24]);
  }
  return b;
};

export const firstFreeSlot = (s: RootState): { start: number; end: number } | null => {
  const busy = nsBusy(s);
  for (let h = 0; h < 24; h++) {
    if (!busy.some((iv) => h >= iv[0] && h < iv[1])) {
      let end = 24;
      for (const iv of busy) if (iv[0] > h && iv[0] < end) end = iv[0];
      return { start: h, end: h + Math.min(2, end - h) };
    }
  }
  return null;
};

export const nsNextBusy = (s: RootState, st: number): number => {
  let m = 24;
  for (const iv of nsBusy(s)) if (iv[0] >= st && iv[0] < m) m = iv[0];
  return m;
};

export const openNewScene = (): Thunk => (dispatch, getState) => {
  const slot = firstFreeSlot(getState());
  dispatch(scenesActions.openNewScene({ name: "", start: slot?.start ?? 0, end: slot?.end ?? 0, noSlot: !slot }));
};

export const createScene = (): Thunk => (dispatch, getState) => {
  const root = getState();
  const s = root.scenes;
  const start = s.nsStart;
  const end = s.nsEnd;
  if (end <= start) return;
  for (const iv of nsBusy(root)) if (start < iv[1] && iv[0] < end) return; // overlap guard
  const seq = (s.sceneSeq || 0) + 1;
  const id = "scene" + Date.now();
  const sl = String(start).padStart(2, "0") + ":00";
  const el = String(end).padStart(2, "0") + ":00";
  const nm = s.nsName.trim();
  const scene: Scene = {
    name: nm || "Scéna " + seq,
    name_en: nm || "Scene " + seq,
    use: sl + "–" + el,
    use_en: sl + "–" + el,
    startH: start,
    endH: end,
    startLabel: sl,
    endLabel: el,
    scheduled: true,
    regions: {},
  };
  dispatch(scenesActions.insertScene({ id, scene, bumpSeq: true }));
  dispatch(editScene(id, "scenes"));
  dispatch(toast(Lof(root).tNewScene));
};

export const addWindow = (): Thunk => (dispatch, getState) => {
  const s = getState().scenes;
  const seq = s.winSeq + 1;
  const id = "win" + seq;
  const time = "06:00–10:00";
  const scene: Scene = {
    name: "Okno " + seq,
    name_en: "Window " + seq,
    use: "default · " + time,
    use_en: "default · " + time,
    startH: 6,
    startLabel: "06:00",
    endLabel: "10:00",
    scheduled: true,
    regions: {},
  };
  dispatch(scenesActions.addWindowScene({ id, scene, window: { time, scene: id }, seq }));
  dispatch(editScene(id, "windows"));
};

/** Persist the current scenes back to the live layout store + apply to mirror. */
const pushLayoutLive = (): Thunk => async (dispatch, getState) => {
  const s = getState();
  let store = s.mirror.layout;
  if (!store) {
    try {
      store = await api.getLayout();
    } catch (e) {
      dispatch(mirrorActions.setError(String(e)));
      return;
    }
  }
  const next = scenesToStore(store, s.mirror.currentUserKey, s.scenes.scenes);
  dispatch(mirrorActions.setLayout(next));
  try {
    await api.putLayout(next);
    await api.applyLayout();
    // Make the core re-read pages.js. apply_layout relies on the frontend to
    // publish the reload — do it BOTH via the backend bridge (reliable; core is
    // on mqtt://127.0.0.1:1883) and directly over the browser's WS.
    await api.mqttPublish(TOPICS.profileReload, "").catch(() => {});
    publish(TOPICS.profileReload, { user: s.mirror.currentUserKey });
    // Immediately project the active layout so the change shows at once,
    // instead of waiting for the next presence/recognition event.
    const st = getState();
    const activeId = resolveActiveId(st.scenes.scenes);
    const layout = regionsToEntries(st.scenes.scenes[activeId]?.regions || {});
    await api.mqttPublish(TOPICS.profilePreview, { layout }).catch(() => {});
    publish(TOPICS.profilePreview, { layout });
    const fresh = await api.getLayout().catch(() => null);
    if (fresh) dispatch(mirrorActions.setLayout(fresh));
    dispatch(toast(Lof(getState()).tApplied));
  } catch (e) {
    dispatch(mirrorActions.setError(String(e)));
    dispatch(toast(en(getState()) ? "Apply failed — see Comms" : "Aplikace selhala — viz Komunikace"));
  }
};

export const applyMirror = (): Thunk => (dispatch, getState) => {
  dispatch(scenesActions.applyLive());
  const s = getState();
  if (s.mirror.live) {
    dispatch(pushLayoutLive()); // toasts apply result
  } else {
    // MQTT-first fallback: tell the core to re-read the active layout.
    publish(TOPICS.profileReload, { scene: s.scenes.activeScene });
    dispatch(toast(Lof(s).tApplied));
  }
  dispatch(startLiveLoad());
};

export const applyAndHome = (): Thunk => (dispatch) => {
  dispatch(applyMirror());
  dispatch(nav("home", "home"));
};

export const wake = (): Thunk => (dispatch, getState) => {
  publish(TOPICS.wake, "1");
  dispatch(toast(Lof(getState()).tWake));
  dispatch(startLiveLoad());
};

// --- global async task (progress). Simulated; hook installStatus() for real. ---
export const startTask =
  (label: string, opts: { kind: TaskKind; target: string | null; onDone?: () => void }): Thunk =>
  (dispatch, getState) => {
    clearInterval(taskInt);
    clearTimeout(taskDoneT);
    dispatch(uiActions.taskStart({ label, kind: opts.kind, target: opts.target }));
    taskInt = setInterval(() => {
      const p = getState().ui.taskPct;
      const np = Math.min(100, p + (p < 80 ? 2.5 + Math.random() * 6 : 0.8 + Math.random() * 2));
      dispatch(uiActions.taskProgress(np));
      if (np >= 100) {
        clearInterval(taskInt);
        taskDoneT = setTimeout(() => {
          dispatch(uiActions.taskClear());
          opts.onDone?.();
        }, 700);
      }
    }, 450);
  };

export const startInstall =
  (name: string): Thunk =>
  (dispatch, getState) => {
    const L = Lof(getState());
    if (getState().mirror.live) {
      dispatch(installLive(name));
      return;
    }
    dispatch(
      startTask(L.taskInstall + " " + name, {
        kind: "install",
        target: name,
        onDone: () => {
          dispatch(modulesActions.install(name));
          dispatch(toast(Lof(getState()).tInstalled));
        },
      })
    );
  };

/** Real install: kick the backend, poll /store/install/status into the task bar. */
const installLive =
  (name: string): Thunk =>
  (dispatch, getState) => {
    const L = Lof(getState());
    dispatch(uiActions.taskStart({ label: L.taskInstall + " " + name, kind: "install", target: name }));
    clearInterval(taskInt);
    api.installModule(name).catch((e) => dispatch(mirrorActions.setError(String(e))));
    taskInt = setInterval(async () => {
      try {
        const st = await api.installStatus(name);
        dispatch(uiActions.taskProgress(Math.min(99, st.percent || 0)));
        if (st.done) {
          clearInterval(taskInt);
          dispatch(uiActions.taskProgress(100));
          await dispatch(refreshStoreData());
          taskDoneT = setTimeout(() => {
            dispatch(uiActions.taskClear());
            dispatch(toast(st.ok === false ? String(st.error || "error") : Lof(getState()).tInstalled));
          }, 500);
        }
      } catch (e) {
        clearInterval(taskInt);
        dispatch(uiActions.taskClear());
        dispatch(mirrorActions.setError(String(e)));
      }
    }, 700);
  };

// --- AI agent (workshop). Simulated 4-step status; swap for streamed LLM. ---
export const agentSend =
  (text?: string): Thunk =>
  (dispatch, getState) => {
    const m = getState().modules;
    const v = (text ?? m.chatDraft).trim();
    if (!v) return;
    const L = Lof(getState());
    agentTimers.forEach(clearTimeout);
    agentTimers = [];
    const steps = [L.agentStep1, L.agentStep2, L.agentStep3, L.agentStep4];
    dispatch(modulesActions.chatUserSend(v));
    dispatch(uiActions.agentStart({ status: steps[0], mod: getState().modules.workshopMod }));
    let d = 1000;
    steps.slice(1).forEach((step) => {
      agentTimers.push(setTimeout(() => dispatch(uiActions.agentStatus(step)), d));
      d += 1000;
    });
    agentTimers.push(
      setTimeout(() => {
        dispatch(modulesActions.pushChat({ role: "bot", text: Lof(getState()).wsBot }));
        dispatch(uiActions.agentDone({ ready: getState().ui.screen !== "workshop" }));
      }, d + 250)
    );
  };

export const openWorkshop =
  (name: string, asDraft?: boolean): Thunk =>
  (dispatch, getState) => {
    const L = Lof(getState());
    dispatch(modulesActions.openWorkshop({ name, asDraft, greeting: `${L.wsReadyA} ${name} ${L.wsReadyB}` }));
    dispatch(nav("workshop", "modules"));
  };

export const doCreate = (): Thunk => (dispatch, getState) => {
  const name = getState().modules.createName.trim() || "MMM-Test";
  dispatch(modulesActions.resetCreate());
  dispatch(openWorkshop(name));
};

export const wsSaveDraft = (): Thunk => (dispatch, getState) => {
  const m = getState().modules;
  const name = m.workshopMod;
  const draft: Draft = {
    n: name,
    c: name.replace(/^MMM-/, ""),
    ce: name.replace(/^MMM-/, ""),
    d: m.createDesc || "",
    de: m.createDesc || "",
    t: ["rozpracováno"],
    te: ["draft"],
    mini: [name.replace(/^MMM-/, "").slice(0, 8).toUpperCase()],
  };
  dispatch(modulesActions.saveDraft(draft));
  dispatch(toast(Lof(getState()).tDraftSaved));
  dispatch(nav("modules", "modules"));
};

export const wsInstallNew = (): Thunk => (dispatch, getState) => {
  const name = getState().modules.workshopMod;
  dispatch(modulesActions.removeDraft(name));
  dispatch(startInstall(name));
  dispatch(nav("modules", "modules"));
};

export const wsInstallNow = (): Thunk => (dispatch, getState) => {
  const name = getState().modules.workshopMod;
  dispatch(modulesActions.removeDraft(name));
  dispatch(startInstall(name));
};

export const submitCtrlForm = (): Thunk => (dispatch, getState) => {
  const m = getState().modules;
  const L = Lof(getState());
  const typeLabel = { toggle: L.cfTypeToggle, select: L.cfTypeSelect, slider: L.cfTypeSlider }[m.ctrlType];
  const summary =
    L.cfQ1.replace(/[:?]/g, "") + ": " + (m.ctrlWhat || "—") + " · " + L.cfQ2 + ": " + typeLabel + " · " + L.cfQ3.replace(/[:?]/g, "") + ": " + (m.ctrlDefault || "—");
  dispatch(modulesActions.submitCtrlForm({ summary, ack: L.ctrlAck }));
};

export const addCtrl = (): Thunk => (dispatch, getState) => {
  const L = Lof(getState());
  dispatch(modulesActions.openCtrlForm({ ctrlMsg: L.ctrlMsg, ctrlIntro: L.ctrlIntro }));
};

// --- modules confirmations ---
export const confirmUninstall = (): Thunk => (dispatch, getState) => {
  const name = getState().modules.uninstallModal;
  if (!name) return;
  dispatch(modulesActions.closeUninstall());
  if (getState().mirror.live) {
    api
      .uninstallModule(name)
      .then(() => dispatch(refreshStoreData()))
      .then(() => dispatch(toast(Lof(getState()).tUninstall)))
      .catch((e) => dispatch(mirrorActions.setError(String(e))));
    return;
  }
  dispatch(modulesActions.uninstall(name));
  dispatch(toast(Lof(getState()).tUninstall));
};

export const confirmDeleteMod = (): Thunk => (dispatch, getState) => {
  const name = getState().modules.deleteModModal;
  if (!name) return;
  dispatch(modulesActions.deleteOwnMod(name));
  dispatch(scenesActions.purgeModule(name));
  dispatch(modulesActions.closeDeleteMod());
  dispatch(toast(Lof(getState()).tModDeleted));
  dispatch(nav("modules", "modules"));
};

export const openDetail =
  (mod: import("@/types").Module): Thunk =>
  (dispatch) => {
    dispatch(modulesActions.setDetail(mod));
    dispatch(uiActions.setScreenTab({ screen: "moddetail", tab: "modules" }));
  };

export const openModByName =
  (name: string): Thunk =>
  (dispatch, getState) => {
    const m = STORE(en(getState())).find((x) => x.n === name);
    if (m) dispatch(openDetail(m));
  };

// --- profiles ---
export const openProfile =
  (name: string): Thunk =>
  (dispatch, getState) => {
    dispatch(profilesActions.openProfile(name));
    dispatch(nav("profile", "profiles"));
    if (getState().mirror.live) dispatch(loadProfileLive(name));
  };

export const toggleTempActive = (): Thunk => (dispatch, getState) => {
  const on = getState().profiles.tempActiveProfile === getState().profiles.profileName;
  dispatch(profilesActions.toggleTempActive());
  dispatch(toast(on ? Lof(getState()).tTempOff : Lof(getState()).tTempOn));
};

export const endTempActive = (): Thunk => (dispatch, getState) => {
  dispatch(profilesActions.endTempActive());
  dispatch(toast(Lof(getState()).tTempOff));
};

export const confirmDeleteProfile = (): Thunk => (dispatch, getState) => {
  const name = getState().profiles.profileName;
  if (getState().mirror.live) {
    dispatch(profilesActions.closeProfileDel());
    api
      .deleteProfile(name)
      .then((r) => {
        const list = r.profiles.filter((p) => !p.builtin).map((p) => ({ id: p.name, name: p.name, photos: p.count, scenes: 0 }));
        dispatch(profilesActions.loadProfiles(list));
        dispatch(toast(Lof(getState()).tProfileDeleted));
        dispatch(nav("profiles", "profiles"));
      })
      .catch((e) => dispatch(mirrorActions.setError(String(e))));
    return;
  }
  dispatch(profilesActions.deleteCurrentProfile());
  dispatch(toast(Lof(getState()).tProfileDeleted));
  dispatch(nav("profiles", "profiles"));
};

const captureLive = (phone: boolean): Thunk => (dispatch, getState) => {
  const name = getState().profiles.profileName;
  api
    .capture(name)
    .then((r) => {
      dispatch(profilesActions.pushRealPhoto({ file: r.file, src: api.photoUrl(name, r.file) }));
      dispatch(toast(phone ? Lof(getState()).tPhotoAdded : Lof(getState()).tPhotoTaken));
    })
    .catch((e) => dispatch(mirrorActions.setError(String(e))));
};

export const takePhoto = (): Thunk => (dispatch, getState) => {
  const phone = getState().profiles.photoSource === "phone";
  if (getState().mirror.live) return dispatch(captureLive(phone));
  dispatch(profilesActions.capturePhoto({ toSession: true }));
  dispatch(toast(phone ? Lof(getState()).tPhotoAdded : Lof(getState()).tPhotoTaken));
};

export const shootPhoto = (): Thunk => (dispatch, getState) => {
  if (getState().mirror.live) return dispatch(captureLive(false));
  dispatch(profilesActions.capturePhoto({ toSession: true }));
  dispatch(toast(Lof(getState()).tPhotoTaken));
};

export const usePhotos = (): Thunk => (dispatch, getState) => {
  const L = Lof(getState());
  const name = getState().profiles.profileName;
  if (getState().mirror.live) {
    api.setMode("face_detect").catch(() => {});
    api.encode(name).catch((e) => dispatch(mirrorActions.setError(String(e))));
  }
  dispatch(startTask(L.taskRetrain, { kind: "retrain", target: null, onDone: () => dispatch(toast(Lof(getState()).tTaskDone)) }));
  dispatch(nav("profile", "profiles"));
};

export const confirmDeletePhoto = (): Thunk => (dispatch, getState) => {
  const p = getState().profiles;
  if (getState().mirror.live) {
    const ph = p.facePhotos.find((x) => x.id === p.photoDelModal);
    dispatch(profilesActions.closePhotoDel());
    if (ph?.file) {
      api
        .deletePhoto(p.profileName, ph.file)
        .then((r) => {
          const photos = r.photos.map((file, i) => ({ id: file, file, n: i + 1, hue: (i * 47 + 18) % 360, src: api.photoUrl(p.profileName, file) }));
          dispatch(profilesActions.loadFacePhotos(photos));
          dispatch(toast(Lof(getState()).tPhotoDel));
        })
        .catch((e) => dispatch(mirrorActions.setError(String(e))));
    }
    return;
  }
  dispatch(profilesActions.confirmDeletePhoto());
  dispatch(toast(Lof(getState()).tPhotoDel));
};

export const finishWizard = (): Thunk => (dispatch, getState) => {
  const p = getState().profiles;
  const name = p.npName.trim() || "Profil";
  dispatch(profilesActions.finishWizard({ id: "p" + Date.now(), name, photos: p.npPhotos, scenes: p.npScenes.length }));
  dispatch(toast(Lof(getState()).tProfileAdded));
  dispatch(nav("profiles", "profiles"));
  const L = Lof(getState());
  dispatch(
    startTask(L.taskNewProfile.replace("{name}", name), {
      kind: "retrain",
      target: null,
      onDone: () => dispatch(toast(Lof(getState()).tProfileTrained)),
    })
  );
};

export const startWizard = (): Thunk => (dispatch) => {
  dispatch(profilesActions.startWizard());
  dispatch(nav("newprofile", "profiles"));
};

export const openAddPhotos = (): Thunk => (dispatch, getState) => {
  dispatch(profilesActions.resetSession("mirror"));
  dispatch(nav("addphotos", "profiles"));
  if (getState().mirror.live) api.setMode("learn").catch(() => {}); // enable capture
};

// --- dev mode ---
export const titleTap = (): Thunk => (dispatch, getState) => {
  if (getState().dev.devMode) return;
  titleClicks += 1;
  clearTimeout(titleResetT);
  titleResetT = setTimeout(() => (titleClicks = 0), 1600);
  const need = 5 - titleClicks;
  if (need > 0) {
    const s = getState();
    const msg = en(s)
      ? `${need} more ${need === 1 ? "click" : "clicks"}`
      : `Ještě ${need} ${need === 1 ? "klik" : need <= 4 ? "kliky" : "kliků"}`;
    dispatch(toast(msg));
  } else {
    titleClicks = 0;
    dispatch(devActions.openPw());
  }
};

export const pwSubmit = (): Thunk => (dispatch, getState) => {
  if (getState().dev.pwInput.trim() === "1234") {
    dispatch(devActions.enterDev());
    dispatch(nav("radar", "radar"));
    dispatch(toast(Lof(getState()).tDevOn));
  } else {
    dispatch(devActions.pwError());
  }
};

export const exitDev = (): Thunk => (dispatch) => {
  dispatch(devActions.exitDev());
  dispatch(nav("home", "home"));
};

export const sendMqtt =
  (topic: string, payload: string): Thunk =>
  (dispatch, getState) => {
    publish(topic, payload);
    const d = new Date();
    const t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    dispatch(devActions.sentMsg({ t, dir: "→", dirColor: "#3bd17a", topic, payload }));
    dispatch(toast(en(getState()) ? "Message sent" : "Zpráva odeslána"));
  };

export const searchMirror = (): Thunk => (dispatch, getState) => {
  if (getState().dev.connState === "scanning") return;
  const ips = ["192.168.1.2", "192.168.1.7", "192.168.1.18", "192.168.1.23", "192.168.1.31", "192.168.1.36", "192.168.1.42"];
  let i = 0;
  clearInterval(scanInt);
  clearTimeout(scanTo);
  dispatch(devActions.setConnState("scanning"));
  dispatch(devActions.setScanIp(ips[0]));
  scanInt = setInterval(() => {
    i = (i + 1) % ips.length;
    dispatch(devActions.setScanIp(ips[i]));
  }, 360);
  scanTo = setTimeout(() => {
    clearInterval(scanInt);
    dispatch(devActions.setConnState("found"));
    dispatch(devActions.setScanIp("192.168.1.42"));
    dispatch(toast(Lof(getState()).tMirrorFound));
  }, 2700);
};

export const toggleRadar = (): Thunk => (dispatch, getState) => {
  const next = !getState().dev.radarActive;
  dispatch(devActions.setRadarActive(next));
  // MQTT-first: command the radar daemon; also flip the systemd unit when live.
  publish(TOPICS.radarControl, { active: next });
  if (getState().mirror.live) api.setRadar(next).catch((e) => dispatch(mirrorActions.setError(String(e))));
};

export const newSceneFromCal =
  (start: number, end: number): Thunk =>
  (dispatch) => {
    dispatch(scenesActions.openNewScene({ name: "", start, end, noSlot: false }));
  };

export { nsBusy };
