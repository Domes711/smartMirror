import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CatalogEntry, LayoutStore } from "@/services/api";

export interface MirrorState {
  /** backend reachable (REST) */
  connected: boolean;
  /** real data successfully loaded (else the app runs on seed mocks) */
  live: boolean;
  error: string | null;
  layout: LayoutStore | null;
  positions: string[];
  catalogEntries: CatalogEntry[];
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
    setModulesMeta(s, a: PayloadAction<{ positions: string[]; catalog: CatalogEntry[] }>) {
      s.positions = a.payload.positions;
      s.catalogEntries = a.payload.catalog;
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
