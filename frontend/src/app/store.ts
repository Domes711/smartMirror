import { configureStore } from "@reduxjs/toolkit";
import ui from "@/features/ui/uiSlice";
import scenes from "@/features/scenes/scenesSlice";
import modules from "@/features/modules/modulesSlice";
import profiles from "@/features/profiles/profilesSlice";
import dev from "@/features/dev/devSlice";
import settings from "@/features/settings/settingsSlice";
import mirror from "@/features/mirror/mirrorSlice";

export const store = configureStore({
  reducer: { ui, scenes, modules, profiles, dev, settings, mirror },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
