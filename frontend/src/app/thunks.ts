import type { AppDispatch, RootState } from "./store";
import { uiActions, groupOf } from "@/features/ui/uiSlice";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { modulesActions } from "@/features/modules/modulesSlice";
import { profilesActions } from "@/features/profiles/profilesSlice";
import { devActions } from "@/features/dev/devSlice";
import { LABELS } from "@/i18n/labels";
import type { Scene, ScreenId, TabGroup, TaskKind } from "@/types";
import { publish, TOPICS } from "@/services/mqtt";
import { STORE } from "@/data/catalog";
import { scenesToStore, regionsToEntries, buildUserScenes, userKeyOf } from "@/app/connect";
import { scenesApi } from "@/app/api/scenesApi";
import { modulesApi } from "@/app/api/modulesApi";
import { cameraApi } from "@/app/api/cameraApi";
import { radarApi } from "@/app/api/radarApi";
import { photoUrl } from "@/services/api";
import { resolveActiveId } from "@/app/selectors";

type Thunk = (dispatch: AppDispatch, getState: () => RootState) => void;

const Lof = (s: RootState) => LABELS[s.ui.lang] as Record<string, string>;
const en = (s: RootState) => s.ui.lang === "en";

// --- module-level timers (single in-flight each) ---
let toastT: ReturnType<typeof setTimeout> | undefined;
let liveT: ReturnType<typeof setTimeout> | undefined;
let taskInt: ReturnType<typeof setInterval> | undefined;
let taskDoneT: ReturnType<typeof setTimeout> | undefined;
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

export const saveSceneAndBack = (): Thunk => (dispatch, getState) => {
  dispatch(pushLayoutLive()); // toasts apply result
  const s = getState().scenes;
  dispatch(nav(s.editReturn as ScreenId, groupOf(s.editReturn as ScreenId)));
};

export const discardAndBack = (): Thunk => (dispatch, getState) => {
  dispatch(scenesActions.discardEdit());
  const s = getState().scenes;
  dispatch(nav(s.editReturn as ScreenId, groupOf(s.editReturn as ScreenId)));
};

export const confirmDelScene = (): Thunk => (dispatch) => {
  dispatch(scenesActions.confirmDelScene());
  dispatch(pushLayoutLive()); // persist + apply
  dispatch(nav("scenes", "scenes"));
};

/** Region-plus: place held / move selected, with the right toast. */
// --- placement helpers (palette TYPE → real instance id) ---
const catalogOf = (s: RootState) => scenesApi.endpoints.getScenesModules.select()(s).data;
const layoutOf = (s: RootState) => scenesApi.endpoints.getLayout.select()(s).data;
const loadedByModuleOf = (s: RootState) => catalogOf(s)?.loaded_by_module || {};
const isCatalogType = (type: string, s: RootState) => (catalogOf(s)?.catalog || []).some((c) => c.type === type);
const reusableInstance = (type: string, s: RootState): string | null =>
  (layoutOf(s)?.instances || []).find((i) => i.type === type)?.id || loadedByModuleOf(s)[type]?.[0] || null;
const requiredFields = (type: string, s: RootState) =>
  (catalogOf(s)?.catalog || []).find((c) => c.type === type)?.fields?.filter((f) => f.required) || [];
function freshInstanceId(type: string, s: RootState): string {
  const taken = new Set<string>([...(layoutOf(s)?.instances || []).map((i) => i.id), ...Object.values(loadedByModuleOf(s)).flat()]);
  let id = type;
  let n = 2;
  while (taken.has(id)) id = `${type}-${n++}`;
  return id;
}

/** Add a freshly-created instance to the cached layout (persisted on apply). */
function addInstance(dispatch: AppDispatch, id: string, type: string, values: Record<string, unknown>): void {
  dispatch(
    scenesApi.util.updateQueryData("getLayout", undefined, (draft) => {
      if (!draft.instances) draft.instances = [];
      if (!draft.instances.some((i) => i.id === id)) draft.instances.push({ id, type, values });
    })
  );
}

/**
 * Resolve a palette id to a real instance id. A palette entry can be a catalog
 * TYPE (built-in / installed / own) — placing it reuses an existing instance of
 * that type (no duplicate), or creates a fresh one. Existing instance ids pass
 * through unchanged. New instances are added to the cached layout (persisted on apply).
 */
function resolvePlaceId(id: string, dispatch: AppDispatch, getState: () => RootState): string {
  const s = getState();
  if (!isCatalogType(id, s)) return id;
  const reuse = reusableInstance(id, s);
  if (reuse) return reuse;
  const newId = freshInstanceId(id, s);
  addInstance(dispatch, newId, id, {});
  return newId;
}

/** A brand-new instance of `type` would need required config we can't infer. */
const needsConfig = (type: string, s: RootState) =>
  isCatalogType(type, s) && !reusableInstance(type, s) && requiredFields(type, s).length > 0;

/** New instances are set up through the AI chat when the agent is available. */
const cfgMode = (s: RootState): "ai" | "form" => (s.modules.aiAvailable ? "ai" : "form");

export const regionPlus =
  (rid: import("@/types").RegionId): Thunk =>
  (dispatch, getState) => {
    const s = getState().scenes;
    if (!s.picked && !s.selChip) {
      dispatch(toast(Lof(getState()).tSelect));
      return;
    }
    if (s.picked) {
      if (needsConfig(s.picked, getState())) {
        dispatch(scenesActions.openCfgModal({ type: s.picked, rid, mode: cfgMode(getState()) }));
        return;
      }
      const id = resolvePlaceId(s.picked, dispatch, getState);
      dispatch(scenesActions.placeSpecificAt({ rid, id }));
      dispatch(toast(Lof(getState()).tAdded));
    } else {
      dispatch(scenesActions.placeAt(rid)); // moving the selected chip
      dispatch(toast(Lof(getState()).tMoved));
    }
  };

export const addModToZone =
  (rid: import("@/types").RegionId, mod: string): Thunk =>
  (dispatch, getState) => {
    if (needsConfig(mod, getState())) {
      dispatch(scenesActions.openCfgModal({ type: mod, rid, mode: cfgMode(getState()) }));
      return;
    }
    const id = resolvePlaceId(mod, dispatch, getState);
    dispatch(scenesActions.addModToZone({ rid, mod: id }));
    dispatch(toast(Lof(getState()).tAdded));
  };

/** A config value counts as filled when it isn't empty/whitespace. */
const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

/** Required fields the current config modal (form or AI chat) still lacks. */
export const missingCfgFields = (s: RootState) => {
  const sc = s.scenes;
  if (!sc.cfgType) return [];
  const values: Record<string, unknown> = sc.cfgMode === "ai" ? sc.cfgAiValues : sc.cfgValues;
  return requiredFields(sc.cfgType, s).filter((f) => !filled(values[f.key]));
};

/** Submit the required-config modal: create the configured instance + place it. */
export const submitCfg = (): Thunk => (dispatch, getState) => {
  const s = getState().scenes;
  const type = s.cfgType;
  const rid = s.cfgRid;
  if (!type || !rid) return;
  if (missingCfgFields(getState()).length) {
    dispatch(toast(Lof(getState()).cfgMissing));
    return;
  }
  const id = freshInstanceId(type, getState());
  addInstance(dispatch, id, type, s.cfgMode === "ai" ? { ...s.cfgAiValues } : { ...s.cfgValues });
  dispatch(scenesActions.placeSpecificAt({ rid, id }));
  dispatch(scenesActions.closeCfgModal());
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
  let store = layoutOf(s);
  if (!store) {
    try {
      store = await dispatch(scenesApi.endpoints.getLayout.initiate(undefined, { forceRefetch: true })).unwrap();
    } catch (e) {
      dispatch(toast(String(e)));
      return;
    }
  }
  const next = scenesToStore(store, s.scenes.userKey, s.scenes.scenes);
  try {
    await dispatch(scenesApi.endpoints.putLayout.initiate(next)).unwrap();
    await dispatch(scenesApi.endpoints.applyLayout.initiate()).unwrap();
    // Nudge the core to re-read pages.js. The backend also announces the
    // apply on smartmirror/scenes/applied; this publish targets the user
    // whose layout changed so the mirror re-projects immediately.
    publish(TOPICS.profileReload, { user: s.scenes.userKey });
    // Immediately project the active layout so the change shows at once,
    // instead of waiting for the next presence/recognition event.
    const st = getState();
    const activeId = resolveActiveId(st.scenes.scenes);
    const layout = regionsToEntries(st.scenes.scenes[activeId]?.regions || {});
    publish(TOPICS.profilePreview, { layout });
    dispatch(toast(Lof(getState()).tApplied));
  } catch (e) {
    dispatch(toast(en(getState()) ? "Apply failed — see Comms" : "Aplikace selhala — viz Komunikace"));
  }
};

export const applyMirror = (): Thunk => (dispatch) => {
  dispatch(scenesActions.applyLive());
  dispatch(pushLayoutLive()); // toasts apply result
  dispatch(startLiveLoad());
};

export const applyAndHome = (): Thunk => (dispatch) => {
  dispatch(applyMirror());
  dispatch(nav("home", "home"));
};

export const wake = (): Thunk => (dispatch, getState) => {
  // power the monitor back on (DDC/CI daemon) and pull the core out of sleep
  publish(TOPICS.displayPower, "on");
  publish(TOPICS.wake, "1");
  dispatch(toast(Lof(getState()).tWake));
  dispatch(startLiveLoad());
};

/** Monitor to standby + the core back to `asleep`. */
export const sleep = (): Thunk => (dispatch, getState) => {
  publish(TOPICS.displayPower, "standby");
  publish(TOPICS.controlReset, "1");
  dispatch(toast(Lof(getState()).tSleep));
};

/** One button for both: wake a sleeping display, put a running one to sleep.
 * `displayOn` comes from the caller — displayApi's retained-state query. */
export const toggleDisplay =
  (displayOn: boolean | null): Thunk =>
  (dispatch) => {
    if (displayOn === true) dispatch(sleep());
    else dispatch(wake());
  };

/** Show a short note on the mirror (core → alert module). `timer` is in ms. */
export const sendMirrorMessage =
  (text: string, timer: number): Thunk =>
  (dispatch, getState) => {
    const message = text.trim();
    if (!message) return;
    publish(TOPICS.message, { message, timer });
    dispatch(toast(Lof(getState()).tMsgSent));
  };

// --- global async task (progress bar), driven to completion by the caller ---
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

/** Kick the backend install + subscribe to its retained progress topic
 * (modulesApi.getInstallStatus pushes updates — no polling needed). */
export const startInstall =
  (name: string): Thunk =>
  (dispatch, getState) => {
    const L = Lof(getState());
    dispatch(uiActions.taskStart({ label: L.taskInstall + " " + name, kind: "install", target: name }));
    dispatch(modulesApi.endpoints.installModule.initiate(name)).catch((e) => dispatch(toast(String(e))));
    clearInterval(taskInt);
    const sub = dispatch(modulesApi.endpoints.getInstallStatus.initiate(name));
    taskInt = setInterval(() => {
      const st = modulesApi.endpoints.getInstallStatus.select(name)(getState()).data;
      if (!st) return;
      dispatch(uiActions.taskProgress(Math.min(99, st.percent || 0)));
      if (st.done) {
        clearInterval(taskInt);
        sub.unsubscribe();
        dispatch(uiActions.taskProgress(100));
        taskDoneT = setTimeout(() => {
          dispatch(uiActions.taskClear());
          dispatch(toast(st.ok === false ? String(st.error || "error") : Lof(getState()).tInstalled));
        }, 500);
      }
    }, 300);
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
  dispatch(modulesApi.endpoints.uninstallModule.initiate(name))
    .unwrap()
    .then(() => dispatch(toast(Lof(getState()).tUninstall)))
    .catch((e) => dispatch(toast(String(e))));
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
/** Load one profile's windows into the scenes slice + its face photos. */
const loadProfileLive =
  (name: string): Thunk =>
  async (dispatch, getState) => {
    const key = userKeyOf(name);
    dispatch(scenesActions.setUserKey(key));
    const layout = layoutOf(getState());
    if (layout) {
      const en = getState().ui.lang === "en";
      dispatch(scenesActions.loadFromBackend({ userKey: key, ...buildUserScenes(layout, key, en) }));
    }
    try {
      const photos = await dispatch(cameraApi.endpoints.listDataset.initiate(name)).unwrap();
      dispatch(
        profilesActions.loadFacePhotos(
          photos.map((file, i) => ({ id: file, file, n: i + 1, hue: (i * 47 + 18) % 360, src: photoUrl(name, file) }))
        )
      );
    } catch {
      /* keep whatever is there */
    }
  };

export const openProfile =
  (name: string): Thunk =>
  (dispatch) => {
    dispatch(profilesActions.openProfile(name));
    dispatch(nav("profile", "profiles"));
    dispatch(loadProfileLive(name));
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
  dispatch(profilesActions.closeProfileDel());
  dispatch(cameraApi.endpoints.deleteCameraProfile.initiate(name))
    .unwrap()
    .then(() => {
      dispatch(toast(Lof(getState()).tProfileDeleted));
      dispatch(nav("profiles", "profiles"));
    })
    .catch((e) => dispatch(toast(String(e))));
};

const captureLive = (phone: boolean): Thunk => (dispatch, getState) => {
  const name = getState().profiles.profileName;
  dispatch(cameraApi.endpoints.capturePhoto.initiate({ name }))
    .unwrap()
    .then((r) => {
      dispatch(profilesActions.pushRealPhoto({ file: r.file, src: photoUrl(name, r.file) }));
      dispatch(toast(phone ? Lof(getState()).tPhotoAdded : Lof(getState()).tPhotoTaken));
    })
    .catch((e) => dispatch(toast(String(e))));
};

export const takePhoto = (): Thunk => (dispatch, getState) => {
  const phone = getState().profiles.photoSource === "phone";
  dispatch(captureLive(phone));
};

export const shootPhoto = (): Thunk => (dispatch) => {
  dispatch(captureLive(false));
};

export const usePhotos = (): Thunk => (dispatch, getState) => {
  const L = Lof(getState());
  const name = getState().profiles.profileName;
  dispatch(cameraApi.endpoints.setCameraMode.initiate("face_detect")).catch(() => {});
  dispatch(cameraApi.endpoints.encodeFaces.initiate(name))
    .unwrap()
    .then(() => dispatch(toast(Lof(getState()).tTaskDone)))
    .catch((e) => dispatch(toast(String(e))));
  dispatch(startTask(L.taskRetrain, { kind: "retrain", target: null }));
  dispatch(nav("profile", "profiles"));
};

export const confirmDeletePhoto = (): Thunk => (dispatch, getState) => {
  const p = getState().profiles;
  const ph = p.facePhotos.find((x) => x.id === p.photoDelModal);
  dispatch(profilesActions.closePhotoDel());
  if (ph?.file) {
    dispatch(cameraApi.endpoints.deleteDatasetPhoto.initiate({ name: p.profileName, file: ph.file }))
      .unwrap()
      .then((photos) => {
        dispatch(
          profilesActions.loadFacePhotos(
            photos.map((file, i) => ({ id: file, file, n: i + 1, hue: (i * 47 + 18) % 360, src: photoUrl(p.profileName, file) }))
          )
        );
        dispatch(toast(Lof(getState()).tPhotoDel));
      })
      .catch((e) => dispatch(toast(String(e))));
  }
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

export const openAddPhotos = (): Thunk => (dispatch) => {
  dispatch(profilesActions.resetSession("mirror"));
  dispatch(nav("addphotos", "profiles"));
  dispatch(cameraApi.endpoints.setCameraMode.initiate("learn")).catch(() => {}); // enable capture
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
  // MQTT-first: command the radar daemon; also flip the systemd unit.
  publish(TOPICS.radarControl, { active: next });
  dispatch(radarApi.endpoints.setRadarActive.initiate(next)).catch((e) => dispatch(toast(String(e))));
};

export const newSceneFromCal =
  (start: number, end: number): Thunk =>
  (dispatch) => {
    dispatch(scenesActions.openNewScene({ name: "", start, end, noSlot: false }));
  };

export { nsBusy };
