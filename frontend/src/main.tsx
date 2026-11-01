import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "@/app/store";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { modulesActions } from "@/features/modules/modulesSlice";
import { tickClock, startLiveLoad } from "@/app/thunks";
import { scenesApi } from "@/app/api/scenesApi";
import { modulesApi } from "@/app/api/modulesApi";
import { aiModulesApi } from "@/app/api/aiModulesApi";
import { startMirrorBridge } from "@/services/mirrorBridge";
import { startScenePreview } from "@/services/scenePreview";
import { startProfileSync } from "@/services/profileSync";
import App from "./App";
import "./styles/global.css";

// bootstrap: start the clock, kick the home loader, open the MQTT bridge,
// keep derived state (scenes slice, runtime catalog) in sync with the live
// backend, and kick off the queries that drive it — the app always expects
// a live backend, no demo/seed fallback.
store.dispatch(scenesActions.syncLiveFromActive());
store.dispatch(tickClock());
store.dispatch(startLiveLoad());
setInterval(() => store.dispatch(tickClock()), 10000);
startMirrorBridge(store);
startScenePreview(store);
startProfileSync(store);
store.dispatch(scenesApi.endpoints.getLayout.initiate());
store.dispatch(scenesApi.endpoints.getScenesModules.initiate());
// The store catalog is the one big reply (whole MMM-store) — if it fails
// (timeout, broker not up yet) keep retrying, otherwise the Modules screen
// is stuck on the built-in seed list until a reload.
const loadStoreCatalog = (): void => {
  store
    .dispatch(modulesApi.endpoints.getStoreCatalog.initiate(undefined, { forceRefetch: true }))
    .unwrap()
    .catch((e) => {
      console.warn("[store] catalog load failed, retrying in 10 s:", e);
      setTimeout(loadStoreCatalog, 10000);
    });
};
loadStoreCatalog();
store
  .dispatch(aiModulesApi.endpoints.getAiStatus.initiate())
  .unwrap()
  .then((st) => store.dispatch(modulesActions.setAiAvailable(st.claudeCli)))
  .catch(() => store.dispatch(modulesActions.setAiAvailable(false)));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);

// PWA: register the service worker (production only, so dev stays uncached).
//
// Vite hashes every built asset and deletes the previous build's files, so a
// stale cached bundle isn't just outdated — it 404s on import() the moment a
// new deploy has run, which is a blank white screen with no visible error.
// `skipWaiting()`/`clients.claim()` in sw.js make the new worker take over
// immediately, but a page already open keeps running the OLD worker's
// already-fetched JS until it reloads; reloading on `controllerchange` is
// what actually gets a stale tab onto the new bundle without the user
// having to notice and manually refresh.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      // The browser only checks for a new worker on navigation / periodic
      // background ticks by default, which can be minutes away on a tab
      // left open — an explicit check whenever this tab becomes visible
      // again (e.g. switching back to it on a phone) catches a deploy that
      // happened while it was in the background.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
