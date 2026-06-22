import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ChatMsg, CtrlType, Draft, Module } from "@/types";

export type ModFilter = "mine" | "installed" | "search";

export interface ModulesState {
  installed: string[];
  modFilter: ModFilter;
  search: string;
  searchOpen: boolean;
  searchCat: string | null;
  detailMod: Module | null;
  deletedMods: string[];
  drafts: Draft[];
  // AI create / workshop
  createTab: "new" | "drafts";
  createName: string;
  createDesc: string;
  workshopMod: string;
  workshopTab: "chat" | "preview";
  chat: ChatMsg[];
  chatDraft: string;
  wsBackModal: boolean;
  wsEditing: boolean;
  wsImportantOnly: boolean;
  wsMaxCount: number;
  ctrlFormOpen: boolean;
  ctrlWhat: string;
  ctrlType: CtrlType;
  ctrlDefault: string;
  // confirmations
  uninstallModal: string | null;
  deleteModModal: string | null;
  // --- real AI builder (Claude Agent SDK + SSE) ---
  aiAvailable: boolean;
  aiRev: number;
  aiScope: "draft" | "installed";
  aiStreaming: boolean;
  serverDrafts: { name: string; description: string }[] | null;
}

const initialState: ModulesState = {
  installed: ["clock", "MMM-Flights", "MMM-Brno-Transit", "MMM-Mail", "MMM-Package-Tracker", "MMM-Weather", "MMM-Calendar", "MMM-Reminders"],
  modFilter: "mine",
  search: "",
  searchOpen: false,
  searchCat: null,
  detailMod: null,
  deletedMods: [],
  drafts: [
    { n: "MMM-Counter", c: "Odpočet", ce: "Countdown", d: "Odpočet dní do výplaty — velké číslo a popisek.", de: "Countdown of days to payday — big number and a label.", t: ["counter", "rozpracováno"], te: ["counter", "draft"], mini: ["128", "dní / days"] },
    { n: "MMM-NameDays", c: "Svátky", ce: "Name days", d: "Dnešní a zítřejší jmeniny pod hodinami.", de: "Today’s and tomorrow’s name days under the clock.", t: ["svátky", "rozpracováno"], te: ["names", "draft"], mini: ["SVÁTEK", "● Antonín", "○ Ivana"] },
  ],
  createTab: "new",
  createName: "",
  createDesc: "",
  workshopMod: "MMM-Test",
  workshopTab: "chat",
  chat: [],
  chatDraft: "",
  wsBackModal: false,
  wsEditing: false,
  wsImportantOnly: true,
  wsMaxCount: 5,
  ctrlFormOpen: false,
  ctrlWhat: "",
  ctrlType: "toggle",
  ctrlDefault: "",
  uninstallModal: null,
  deleteModModal: null,
  aiAvailable: false,
  aiRev: 1,
  aiScope: "draft",
  aiStreaming: false,
  serverDrafts: null,
};

const modulesSlice = createSlice({
  name: "modules",
  initialState,
  reducers: {
    setInstalled(s, a: PayloadAction<string[]>) {
      s.installed = a.payload;
    },
    setFilter(s, a: PayloadAction<ModFilter>) {
      s.modFilter = a.payload;
    },
    setSearch(s, a: PayloadAction<string>) {
      s.search = a.payload;
    },
    appendSearch(s, a: PayloadAction<string>) {
      s.search += a.payload;
      s.searchCat = null;
    },
    backspaceSearch(s) {
      s.search = s.search.slice(0, -1);
    },
    clearSearch(s) {
      s.search = "";
      s.searchCat = null;
    },
    setSearchOpen(s, a: PayloadAction<boolean>) {
      s.searchOpen = a.payload;
    },
    setSearchCat(s, a: PayloadAction<string | null>) {
      s.searchCat = a.payload;
      if (a.payload) {
        s.search = "";
        s.searchOpen = false;
      }
    },
    setDetail(s, a: PayloadAction<Module | null>) {
      s.detailMod = a.payload;
    },
    install(s, a: PayloadAction<string>) {
      if (!s.installed.includes(a.payload)) s.installed.push(a.payload);
    },
    uninstall(s, a: PayloadAction<string>) {
      s.installed = s.installed.filter((x) => x !== a.payload);
    },
    toggleInstall(s, a: PayloadAction<string>) {
      s.installed = s.installed.includes(a.payload)
        ? s.installed.filter((x) => x !== a.payload)
        : [...s.installed, a.payload];
    },
    deleteOwnMod(s, a: PayloadAction<string>) {
      s.deletedMods.push(a.payload);
      s.installed = s.installed.filter((x) => x !== a.payload);
      s.detailMod = null;
    },
    // confirmations
    openUninstall(s, a: PayloadAction<string>) {
      s.uninstallModal = a.payload;
    },
    closeUninstall(s) {
      s.uninstallModal = null;
    },
    openDeleteMod(s, a: PayloadAction<string>) {
      s.deleteModModal = a.payload;
    },
    closeDeleteMod(s) {
      s.deleteModModal = null;
    },

    // --- create / workshop ---
    setCreateTab(s, a: PayloadAction<"new" | "drafts">) {
      s.createTab = a.payload;
    },
    setCreateName(s, a: PayloadAction<string>) {
      s.createName = a.payload;
    },
    setCreateDesc(s, a: PayloadAction<string>) {
      s.createDesc = a.payload;
    },
    resetCreate(s) {
      s.createName = "";
      s.createDesc = "";
    },
    openWorkshop(s, a: PayloadAction<{ name: string; asDraft?: boolean; greeting: string }>) {
      s.wsEditing = !!a.payload.asDraft;
      s.workshopMod = a.payload.name;
      s.workshopTab = "chat";
      s.chat = [{ role: "bot", text: a.payload.greeting }];
      s.chatDraft = "";
      s.wsBackModal = false;
    },
    setWorkshopTab(s, a: PayloadAction<"chat" | "preview">) {
      s.workshopTab = a.payload;
    },
    setChatDraft(s, a: PayloadAction<string>) {
      s.chatDraft = a.payload;
    },
    pushChat(s, a: PayloadAction<ChatMsg>) {
      s.chat.push(a.payload);
    },
    chatUserSend(s, a: PayloadAction<string>) {
      s.wsEditing = true;
      s.chat.push({ role: "me", text: a.payload });
      s.chatDraft = "";
    },
    setWsEditing(s, a: PayloadAction<boolean>) {
      s.wsEditing = a.payload;
    },
    toggleWsImportant(s) {
      s.wsImportantOnly = !s.wsImportantOnly;
    },
    setWsMax(s, a: PayloadAction<number>) {
      s.wsMaxCount = a.payload;
    },
    openWsBack(s) {
      s.wsBackModal = true;
    },
    closeWsBack(s) {
      s.wsBackModal = false;
    },
    // ctrl form
    openCtrlForm(s, a: PayloadAction<{ ctrlMsg: string; ctrlIntro: string }>) {
      s.wsEditing = true;
      s.workshopTab = "chat";
      s.chat.push({ role: "me", kind: "ctrl", text: a.payload.ctrlMsg });
      s.chat.push({ role: "bot", text: a.payload.ctrlIntro });
      s.ctrlFormOpen = true;
      s.ctrlWhat = "";
      s.ctrlType = "toggle";
      s.ctrlDefault = "";
    },
    setCtrlWhat(s, a: PayloadAction<string>) {
      s.ctrlWhat = a.payload;
    },
    setCtrlType(s, a: PayloadAction<CtrlType>) {
      s.ctrlType = a.payload;
    },
    setCtrlDefault(s, a: PayloadAction<string>) {
      s.ctrlDefault = a.payload;
    },
    submitCtrlForm(s, a: PayloadAction<{ summary: string; ack: string }>) {
      s.wsEditing = true;
      s.chat.push({ role: "me", text: a.payload.summary });
      s.chat.push({ role: "bot", text: a.payload.ack });
      s.ctrlFormOpen = false;
    },
    // --- real AI builder ---
    setAiAvailable(s, a: PayloadAction<boolean>) {
      s.aiAvailable = a.payload;
    },
    setServerDrafts(s, a: PayloadAction<{ name: string; description: string }[]>) {
      s.serverDrafts = a.payload;
    },
    aiOpen(s, a: PayloadAction<{ name: string; scope: "draft" | "installed" }>) {
      s.workshopMod = a.payload.name;
      s.aiScope = a.payload.scope;
      s.workshopTab = "chat";
      s.chat = [];
      s.chatDraft = "";
      s.aiStreaming = false;
      s.wsBackModal = false;
      s.wsEditing = a.payload.scope === "installed";
      s.ctrlFormOpen = false;
    },
    aiSetSession(s, a: PayloadAction<{ messages: ChatMsg[]; rev: number }>) {
      s.chat = a.payload.messages;
      s.aiRev = a.payload.rev;
      s.aiStreaming = false;
    },
    aiUserSend(s, a: PayloadAction<string>) {
      s.wsEditing = true;
      s.chat.push({ role: "me", text: a.payload });
      s.chat.push({ role: "bot", text: "" }); // accumulator
      s.aiStreaming = true;
      s.chatDraft = "";
    },
    aiAppendText(s, a: PayloadAction<string>) {
      const last = s.chat[s.chat.length - 1];
      if (last && last.role === "bot") last.text += a.payload;
      else s.chat.push({ role: "bot", text: a.payload });
    },
    aiStreamDone(s, a: PayloadAction<{ rev: number }>) {
      s.aiStreaming = false;
      s.aiRev = a.payload.rev || s.aiRev + 1;
      const last = s.chat[s.chat.length - 1];
      if (last && last.role === "bot" && !last.text.trim()) last.text = "✓";
    },
    aiError(s, a: PayloadAction<string>) {
      s.aiStreaming = false;
      s.chat.push({ role: "bot", kind: "status", text: a.payload });
    },
    // drafts
    saveDraft(s, a: PayloadAction<Draft>) {
      if (!s.drafts.some((d) => d.n === a.payload.n)) s.drafts.push(a.payload);
      s.wsEditing = false;
      s.wsBackModal = false;
    },
    removeDraft(s, a: PayloadAction<string>) {
      s.drafts = s.drafts.filter((d) => d.n !== a.payload);
      s.wsBackModal = false;
      s.wsEditing = false;
    },
  },
});

export const modulesActions = modulesSlice.actions;
export default modulesSlice.reducer;
