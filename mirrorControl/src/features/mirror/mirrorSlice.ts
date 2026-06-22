import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CatalogEntry, LayoutStore, ModuleInstance } from "@/services/api";

export interface MirrorState {
  /** backend reachable (REST) */
  connected: boolean;
  /** real data successfully loaded (else the app runs on seed mocks) */
  live: boolean;
  error: string | null;
  layout: LayoutStore | null;
  positions: string[];
  catalogEntries: CatalogEntry[];
  /** module name → instance ids already in config.js (reuse, avoid dupes) */
  loadedByModule: Record<string, string[]>;
  /** app profile display-name → backend layout-store user key */
  profileKeys: Record<string, string>;
  /** which profile's windows are currently projected into the scenes slice */
  currentUserKey: string;
}

const initialState: MirrorState = {
  connected: false,
  live: false,
  error: null,
  layout: null,
  positions: [],
  catalogEntries: [],
  loadedByModule: {},
  profileKeys: { default: "default" },
  currentUserKey: "default",
};

const mirrorSlice = createSlice({
  name: "mirror",
  initialState,
  reducers: {
    setConnected(s, a: PayloadAction<boolean>) {
      s.connected = a.payload;
    },
    setLive(s, a: PayloadAction<boolean>) {
      s.live = a.payload;
    },
    setError(s, a: PayloadAction<string | null>) {
      s.error = a.payload;
    },
    setLayout(s, a: PayloadAction<LayoutStore>) {
      s.layout = a.payload;
    },
    setModulesMeta(s, a: PayloadAction<{ positions: string[]; catalog: CatalogEntry[]; loadedByModule?: Record<string, string[]> }>) {
      s.positions = a.payload.positions;
      s.catalogEntries = a.payload.catalog;
      if (a.payload.loadedByModule) s.loadedByModule = a.payload.loadedByModule;
    },
    /** Add a freshly-created module instance (optimistic; persisted on apply). */
    addInstance(s, a: PayloadAction<ModuleInstance>) {
      if (!s.layout) return;
      if (!s.layout.instances) s.layout.instances = [];
      if (!s.layout.instances.some((i) => i.id === a.payload.id)) s.layout.instances.push(a.payload);
    },
    setProfileKeys(s, a: PayloadAction<Record<string, string>>) {
      s.profileKeys = { default: "default", ...a.payload };
    },
    setCurrentUserKey(s, a: PayloadAction<string>) {
      s.currentUserKey = a.payload;
    },
  },
});

export const mirrorActions = mirrorSlice.actions;
export default mirrorSlice.reducer;
