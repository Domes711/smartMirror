import { configureStore } from "@reduxjs/toolkit";
import ui from "@/features/ui/uiSlice";
import scenes from "@/features/scenes/scenesSlice";
import modules from "@/features/modules/modulesSlice";
import profiles from "@/features/profiles/profilesSlice";
import dev from "@/features/dev/devSlice";
import settings from "@/features/settings/settingsSlice";
import mirror from "@/features/mirror/mirrorSlice";
import { cameraApi } from "@/app/api/cameraApi";
import { scenesApi } from "@/app/api/scenesApi";
import { modulesApi } from "@/app/api/modulesApi";
import { radarApi } from "@/app/api/radarApi";
import { displayApi } from "@/app/api/displayApi";
import { aiModulesApi } from "@/app/api/aiModulesApi";
import { micApi } from "@/app/api/micApi";

export const store = configureStore({
  reducer: {
    ui,
    scenes,
    modules,
    profiles,
    dev,
    settings,
    mirror,
    [cameraApi.reducerPath]: cameraApi.reducer,
    [scenesApi.reducerPath]: scenesApi.reducer,
    [modulesApi.reducerPath]: modulesApi.reducer,
    [radarApi.reducerPath]: radarApi.reducer,
    [displayApi.reducerPath]: displayApi.reducer,
    [aiModulesApi.reducerPath]: aiModulesApi.reducer,
    [micApi.reducerPath]: micApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(cameraApi.middleware)
      .concat(scenesApi.middleware)
      .concat(modulesApi.middleware)
      .concat(radarApi.middleware)
      .concat(displayApi.middleware)
      .concat(aiModulesApi.middleware)
      .concat(micApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
