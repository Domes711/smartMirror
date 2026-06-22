import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ConnState, MqttMsg } from "@/types";

export interface DevState {
  devMode: boolean;
  pwModal: boolean;
  pwInput: string;
  pwError: boolean;
  // radar
  radarActive: boolean;
  zoneCx: number;
  zoneW: number;
  zoneFar: number;
  // live radar targets (from MQTT smartmirror/radar/targets)
  liveTargets: { x: number; y: number; speed?: number }[];
  livePresence: boolean | null;
  // connection scan (settings)
  connState: ConnState;
  scanIp: string;
  // comms
  commsPanel: boolean;
  commsName: string;
  sentMsgs: MqttMsg[];
}

const initialState: DevState = {
  devMode: false,
  pwModal: false,
  pwInput: "",
  pwError: false,
  radarActive: true,
  zoneCx: -0.1,
  zoneW: 0.7,
  zoneFar: 1.3,
  liveTargets: [],
  livePresence: null,
  connState: "idle",
  scanIp: "",
  commsPanel: false,
  commsName: "Eliška",
  sentMsgs: [],
};

const devSlice = createSlice({
  name: "dev",
  initialState,
  reducers: {
    openPw(s) {
      s.pwModal = true;
      s.pwInput = "";
      s.pwError = false;
    },
    closePw(s) {
      s.pwModal = false;
      s.pwInput = "";
      s.pwError = false;
    },
    setPwInput(s, a: PayloadAction<string>) {
      s.pwInput = a.payload;
      s.pwError = false;
    },
    pwError(s) {
      s.pwError = true;
    },
    enterDev(s) {
      s.devMode = true;
      s.pwModal = false;
      s.pwInput = "";
      s.pwError = false;
    },
    exitDev(s) {
      s.devMode = false;
    },
    toggleRadar(s) {
      s.radarActive = !s.radarActive;
    },
    setRadarActive(s, a: PayloadAction<boolean>) {
      s.radarActive = a.payload;
    },
    setZoneCx(s, a: PayloadAction<number>) {
      s.zoneCx = a.payload;
    },
    setZoneW(s, a: PayloadAction<number>) {
      s.zoneW = a.payload;
    },
    setZoneFar(s, a: PayloadAction<number>) {
      s.zoneFar = a.payload;
    },
    setLiveTargets(s, a: PayloadAction<{ x: number; y: number; speed?: number }[]>) {
      s.liveTargets = a.payload;
    },
    setPresence(s, a: PayloadAction<boolean>) {
      s.livePresence = a.payload;
    },
    // connection scan
    setConnState(s, a: PayloadAction<ConnState>) {
      s.connState = a.payload;
    },
    setScanIp(s, a: PayloadAction<string>) {
      s.scanIp = a.payload;
    },
    // comms
    openComms(s) {
      s.commsPanel = true;
    },
    closeComms(s) {
      s.commsPanel = false;
    },
    setCommsName(s, a: PayloadAction<string>) {
      s.commsName = a.payload;
    },
    /** Append a line to the monitor (sent or received). */
    logMsg(s, a: PayloadAction<MqttMsg>) {
      s.sentMsgs = [a.payload, ...s.sentMsgs].slice(0, 14);
    },
    sentMsg(s, a: PayloadAction<MqttMsg>) {
      s.sentMsgs = [a.payload, ...s.sentMsgs].slice(0, 14);
      s.commsPanel = false;
    },
  },
});

export const devActions = devSlice.actions;
export default devSlice.reducer;
