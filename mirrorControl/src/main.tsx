import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "@/app/store";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { tickClock, startLiveLoad } from "@/app/thunks";
import { connectMirror } from "@/app/connect";
import { startMirrorBridge } from "@/services/mirrorBridge";
import { startScenePreview } from "@/services/scenePreview";
import App from "./App";
import "./styles/global.css";

// bootstrap: seed live snapshot, start the clock, kick the home loader,
// open the MQTT bridge, and pull REAL data from the mirror-console backend
// (falls back to seed mocks if the backend is unreachable).
store.dispatch(scenesActions.syncLiveFromActive());
store.dispatch(tickClock());
store.dispatch(startLiveLoad());
setInterval(() => store.dispatch(tickClock()), 10000);
startMirrorBridge(store);
startScenePreview(store);
store.dispatch(connectMirror());

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
