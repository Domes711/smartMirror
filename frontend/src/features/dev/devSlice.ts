import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MqttMsg } from "@/types";

export interface DevState {
  devMode: boolean;
  pwModal: boolean;
  pwInput: string;
  pwError: boolean;
  // radar
  radarActive: boolean;
  // live radar targets (from MQTT smartmirror/radar/targets)
  liveTargets: { x: number; y: number; speed?: number }[];
  livePresence: boolean | null;
  // distance sensor (HC-SR04, from MQTT smartmirror/distance/reading + /status)
  distanceActive: boolean;
  distanceCm: number | null;
  distanceNear: boolean;
  // comms
  commsPanel: boolean;
  commsName: string;
  sentMsgs: MqttMsg[];
}

// Kept for the message-log detail view; the Comms screen preview shows the newest few.
const LOG_MAX = 200;

const initialState: DevState = {
  devMode: false,
  pwModal: false,
  pwInput: "",
  pwError: false,
  radarActive: true,
  liveTargets: [],
  livePresence: null,
  distanceActive: true,
  distanceCm: null,
  distanceNear: false,
  commsPanel: false,
  commsName: "",
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
    setLiveTargets(s, a: PayloadAction<{ x: number; y: number; speed?: number }[]>) {
      s.liveTargets = a.payload;
    },
    setPresence(s, a: PayloadAction<boolean>) {
      s.livePresence = a.payload;
    },
    setDistanceActive(s, a: PayloadAction<boolean>) {
      s.distanceActive = a.payload;
    },
    setDistanceReading(s, a: PayloadAction<{ cm: number | null; near: boolean }>) {
      s.distanceCm = a.payload.cm;
      s.distanceNear = a.payload.near;
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
      s.sentMsgs = [a.payload, ...s.sentMsgs].slice(0, LOG_MAX);
    },
    sentMsg(s, a: PayloadAction<MqttMsg>) {
      s.sentMsgs = [a.payload, ...s.sentMsgs].slice(0, LOG_MAX);
      s.commsPanel = false;
    },
  },
});

export const devActions = devSlice.actions;
export default devSlice.reducer;
