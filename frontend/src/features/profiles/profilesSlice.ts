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
  /** Filenames of photos already uploaded to the backend for this
   * in-progress profile (set by capture_upload, not a local guess). */
  npPhotos: string[];
  npUploading: boolean;
  npScenes: string[];
  npTrainStatus: "idle" | "training" | "done" | "error";
  npTrainError: string | null;
}

const initialState: ProfilesState = {
  profiles: [],
  profileName: "default",
  profileTab: "scenes",
  tempActiveProfile: null,
  profileDelOpen: false,
  facePhotos: [],
  photoSheet: null,
  photoDelModal: null,
  photoSource: "mirror",
  sessionPhotos: [],
  npStep: 1,
  npName: "",
  npPhotos: [],
  npUploading: false,
  npScenes: [],
  npTrainStatus: "idle",
  npTrainError: null,
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
      s.npPhotos = [];
      s.npUploading = false;
      s.npScenes = [];
      s.photoSource = "mirror";
      s.npTrainStatus = "idle";
      s.npTrainError = null;
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
    npUploadStart(s) {
      s.npUploading = true;
    },
    /** A photo was actually uploaded to the backend for the in-progress
     * profile — pushed with the real filename capture_upload returned. */
    npPhotoUploaded(s, a: PayloadAction<string>) {
      s.npPhotos.push(a.payload);
      s.npUploading = false;
    },
    npUploadFailed(s) {
      s.npUploading = false;
    },
    npStartTraining(s) {
      s.npTrainStatus = "training";
      s.npTrainError = null;
    },
    npTrainingDone(s) {
      s.npTrainStatus = "done";
    },
    npTrainingFailed(s, a: PayloadAction<string>) {
      s.npTrainStatus = "error";
      s.npTrainError = a.payload;
    },
    npToggleScene(s, a: PayloadAction<string>) {
      s.npScenes = s.npScenes.includes(a.payload)
        ? s.npScenes.filter((x) => x !== a.payload)
        : [...s.npScenes, a.payload];
    },
    finishWizard(s, a: PayloadAction<Profile>) {
      s.profiles.push(a.payload);
      s.npStep = 1;
      s.npName = "";
      s.npPhotos = [];
      s.npScenes = [];
    },
  },
});

export const profilesActions = profilesSlice.actions;
export default profilesSlice.reducer;
