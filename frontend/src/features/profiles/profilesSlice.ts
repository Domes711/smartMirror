import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FacePhoto, Profile } from "@/types";

export type ProfileTab = "scenes" | "face" | "settings";
export type PhotoSource = "mirror" | "phone";

export interface ProfilesState {
  profiles: Profile[];
  profileName: string; // currently open profile
  profileTab: ProfileTab;
  tempActiveProfile: string | null;
  profileDelOpen: boolean;
  facePhotos: FacePhoto[];
  photoSheet: string | null;
  photoDelModal: string | null;
  photoSource: PhotoSource;
  sessionPhotos: FacePhoto[];
  // new-profile wizard
  npStep: 1 | 2 | 3;
  npName: string;
  npPhotos: number;
  npScenes: string[];
  npSource: PhotoSource | null;
  npSheet: boolean;
}

const initialState: ProfilesState = {
  profiles: [{ id: "eliska", name: "Eliška", photos: 12, scenes: 3 }],
  profileName: "default",
  profileTab: "scenes",
  tempActiveProfile: null,
  profileDelOpen: false,
  facePhotos: Array.from({ length: 12 }, (_, i) => ({ id: "fp" + (i + 1), hue: (i * 47 + 18) % 360, n: i + 1 })),
  photoSheet: null,
  photoDelModal: null,
  photoSource: "mirror",
  sessionPhotos: [],
  npStep: 1,
  npName: "",
  npPhotos: 0,
  npScenes: [],
  npSource: null,
  npSheet: false,
};

const profilesSlice = createSlice({
  name: "profiles",
  initialState,
  reducers: {
    /** Replace the profile list from the live mirror (/profiles). */
    loadProfiles(s, a: PayloadAction<Profile[]>) {
      s.profiles = a.payload;
    },
    /** Replace face photos for the open profile from the live dataset. */
    loadFacePhotos(s, a: PayloadAction<FacePhoto[]>) {
      s.facePhotos = a.payload;
    },
    openProfile(s, a: PayloadAction<string>) {
      s.profileTab = "scenes";
      s.photoSheet = null;
      s.photoDelModal = null;
      s.profileName = a.payload;
    },
    setProfileTab(s, a: PayloadAction<ProfileTab>) {
      s.profileTab = a.payload;
      if (a.payload !== "face") {
        s.photoSheet = null;
        s.photoDelModal = null;
      }
    },
    addProfile(s, a: PayloadAction<Profile>) {
      s.profiles.push(a.payload);
    },
    deleteCurrentProfile(s) {
      s.profiles = s.profiles.filter((p) => p.name !== s.profileName);
      if (s.tempActiveProfile === s.profileName) s.tempActiveProfile = null;
      s.profileDelOpen = false;
    },
    toggleTempActive(s) {
      s.tempActiveProfile = s.tempActiveProfile === s.profileName ? null : s.profileName;
    },
    endTempActive(s) {
      s.tempActiveProfile = null;
    },
    openProfileDel(s) {
      s.profileDelOpen = true;
    },
    closeProfileDel(s) {
      s.profileDelOpen = false;
    },

    // --- face photos ---
    setPhotoSource(s, a: PayloadAction<PhotoSource>) {
      s.photoSource = a.payload;
    },
    resetSession(s, a: PayloadAction<PhotoSource>) {
      s.photoSource = a.payload;
      s.sessionPhotos = [];
    },
    /** Append a real captured photo (from the live camera dataset). */
    pushRealPhoto(s, a: PayloadAction<{ file: string; src: string }>) {
      const n = s.facePhotos.reduce((m, p) => Math.max(m, p.n), 0) + 1;
      const ph: FacePhoto = { id: a.payload.file, file: a.payload.file, n, hue: (n * 47 + 18) % 360, src: a.payload.src };
      s.facePhotos.push(ph);
      s.sessionPhotos.push(ph);
    },
    capturePhoto(s, a: PayloadAction<{ toSession: boolean }>) {
      const n = s.facePhotos.reduce((m, p) => Math.max(m, p.n), 0) + 1;
      const np: FacePhoto = { id: "fp" + Date.now(), hue: (n * 47 + 18) % 360, n };
      s.facePhotos.push(np);
      if (a.payload.toSession) s.sessionPhotos.push(np);
    },
    openPhotoSheet(s, a: PayloadAction<string>) {
      s.photoSheet = a.payload;
    },
    closePhotoSheet(s) {
      s.photoSheet = null;
    },
    openPhotoDel(s, a: PayloadAction<string>) {
      s.photoDelModal = a.payload;
    },
    closePhotoDel(s) {
      s.photoDelModal = null;
    },
    confirmDeletePhoto(s) {
      s.facePhotos = s.facePhotos.filter((p) => p.id !== s.photoDelModal);
      s.photoDelModal = null;
      s.photoSheet = null;
    },

    // --- new-profile wizard ---
    startWizard(s) {
      s.npStep = 1;
      s.npName = "";
      s.npPhotos = 0;
      s.npScenes = [];
      s.photoSource = "mirror";
      s.npSource = null;
      s.npSheet = false;
    },
    setNpName(s, a: PayloadAction<string>) {
      s.npName = a.payload;
    },
    setNpStep(s, a: PayloadAction<1 | 2 | 3>) {
      s.npStep = a.payload;
    },
    npBackStep(s) {
      if (s.npStep > 1) s.npStep = (s.npStep - 1) as 1 | 2 | 3;
    },
    npShoot(s) {
      s.npPhotos += 1;
    },
    npToggleScene(s, a: PayloadAction<string>) {
      s.npScenes = s.npScenes.includes(a.payload)
        ? s.npScenes.filter((x) => x !== a.payload)
        : [...s.npScenes, a.payload];
    },
    npPickSource(s, a: PayloadAction<PhotoSource>) {
      s.npSource = a.payload;
      s.npSheet = true;
    },
    npCloseSheet(s) {
      s.npSheet = false;
    },
    finishWizard(s, a: PayloadAction<Profile>) {
      s.profiles.push(a.payload);
      s.npStep = 1;
      s.npName = "";
      s.npPhotos = 0;
      s.npScenes = [];
    },
  },
});

export const profilesActions = profilesSlice.actions;
export default profilesSlice.reducer;
