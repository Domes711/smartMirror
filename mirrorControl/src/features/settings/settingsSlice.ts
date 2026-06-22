import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface SettingsState {
  conn: boolean;
  face: boolean;
  night: boolean;
}

const initialState: SettingsState = { conn: true, face: true, night: false };

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    toggle(s, a: PayloadAction<keyof SettingsState>) {
      s[a.payload] = !s[a.payload];
    },
    set(s, a: PayloadAction<{ key: keyof SettingsState; value: boolean }>) {
      s[a.payload.key] = a.payload.value;
    },
  },
});

export const settingsActions = settingsSlice.actions;
export default settingsSlice.reducer;
