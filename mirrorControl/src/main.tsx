import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "@/app/store";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { tickClock, startLiveLoad } from "@/app/thunks";
import { startMirrorBridge } from "@/services/mirrorBridge";
import App from "./App";
import "./styles/global.css";

// bootstrap: seed live snapshot, start the clock, kick the home loader,
// and open the MQTT bridge to the mirror.
store.dispatch(scenesActions.syncLiveFromActive());
store.dispatch(tickClock());
store.dispatch(startLiveLoad());
setInterval(() => store.dispatch(tickClock()), 10000);
startMirrorBridge(store);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);
