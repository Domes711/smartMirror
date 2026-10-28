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
store.dispatch(modulesApi.endpoints.getStoreCatalog.initiate());
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
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
