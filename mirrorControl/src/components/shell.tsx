import type { ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { uiActions } from "@/features/ui/uiSlice";
import { profilesActions } from "@/features/profiles/profilesSlice";
import * as fx from "@/app/thunks";
import { tokens as C } from "./ui";
import type { TabGroup } from "@/types";

/* ---------- status bar ---------- */
export function StatusBar() {
  const time = useAppSelector((s) => s.ui.time);
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "calc(16px + env(safe-area-inset-top)) 30px 8px",
        fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700,
      }}
    >
      <span>{time}</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 11 }}>
          {[4, 6, 9, 11].map((h) => (
            <i key={h} style={{ width: 3, height: h, background: C.ink, display: "block" }} />
          ))}
        </div>
        <span style={{ border: `1.5px solid ${C.ink}`, borderRadius: 4, padding: "1px 4px", fontSize: 10, lineHeight: 1 }}>19</span>
      </div>
    </div>
  );
}

/* ---------- chrome (wordmark · DEV · gear) ---------- */
export function Chrome() {
  const dispatch = useAppDispatch();
  const { en } = useT();
  const devMode = useAppSelector((s) => s.dev.devMode);
  const onSettings = useAppSelector((s) => s.ui.screen === "settings");
  return (
    <div style={{ padding: "4px 22px 12px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
      <span
        onClick={() => dispatch(fx.titleTap())}
        style={{ fontSize: 13, letterSpacing: ".2em", textTransform: "uppercase", fontWeight: 700, fontFamily: "var(--mono)", cursor: "pointer", userSelect: "none" }}
      >
        Mirror Control
      </span>
      {devMode && (
        <span
          onClick={() => dispatch(fx.exitDev())}
          title={en ? "Exit dev mode" : "Ukončit dev mód"}
          style={{ fontFamily: "var(--mono)", fontSize: 9, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: C.signal, border: `1px solid ${C.signal}`, borderRadius: 999, padding: "2px 7px", lineHeight: 1, cursor: "pointer", userSelect: "none" }}
        >
          DEV
        </span>
      )}
      <button
        onClick={() => dispatch(uiActions.openSettings())}
        style={{ marginLeft: "auto", width: 36, height: 36, border: `1px solid ${C.ink}`, borderRadius: "50%", background: onSettings ? C.ink : "transparent", cursor: "pointer", display: "grid", placeItems: "center", transition: ".18s" }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 17, height: 17, fill: "none", strokeWidth: 1.4, stroke: onSettings ? C.paper : C.ink }}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
        </svg>
      </button>
    </div>
  );
}

/* ---------- task bar ---------- */
export function TaskBar() {
  const dispatch = useAppDispatch();
  const ui = useAppSelector((s) => s.ui);
  const detailN = useAppSelector((s) => s.modules.detailMod?.n);
  const workshopMod = useAppSelector((s) => s.modules.workshopMod);
  const screen = ui.screen;
  // suppress when the install progress is already shown inline (detail/workshop)
  const suppressed =
    ui.taskKind === "install" &&
    ((screen === "moddetail" && detailN === ui.taskTarget) || (screen === "workshop" && workshopMod === ui.taskTarget));
  if (!ui.taskActive || suppressed) return null;
  const clickable = ui.taskKind === "install";
  return (
    <div
      onClick={() => clickable && ui.taskTarget && dispatch(fx.openModByName(ui.taskTarget))}
      style={{ flex: "0 0 auto", padding: "9px 22px 11px", borderBottom: `1px solid ${C.line}`, background: C.p2, animation: "scin .25s ease", cursor: clickable ? "pointer" : "default" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Spinner color="#E5482F" track="#f3c9c0" />
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ui.taskLabel}</span>
        </span>
        <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, color: C.signal }}>{Math.round(ui.taskPct)}%</span>
          {clickable && <Chevron color="#8C8C81" />}
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "#D8D7CB", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${ui.taskPct}%`, background: C.signal, borderRadius: 999, transition: "width .4s ease" }} />
      </div>
    </div>
  );
}

/* ---------- temporary profile bar ---------- */
export function TempBar() {
  const dispatch = useAppDispatch();
  const { en } = useT();
  const profile = useAppSelector((s) => s.profiles.tempActiveProfile);
  if (!profile) return null;
  return (
    <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 22px", borderBottom: `1px solid ${C.line}`, background: "#fff1cf", animation: "scin .25s ease" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, flex: "0 0 auto", fill: C.bink }}><path d="M13 2L4.5 13.5H12l-1 8.5L19.5 10.5H12z" /></svg>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: C.bink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(en ? "Profile temporarily active" : "Profil dočasně aktivní") + " · " + profile}</span>
      </span>
      <button onClick={() => dispatch(fx.endTempActive())} style={{ flex: "0 0 auto", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: C.bink, background: "transparent", border: "1px solid #d9b75a", borderRadius: 999, padding: "5px 11px", cursor: "pointer" }}>
        {en ? "End" : "Ukončit"}
      </button>
    </div>
  );
}

/* ---------- AI agent bar ---------- */
export function AgentBar() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const { agentBusy, agentReady, agentStatus, screen } = useAppSelector((s) => s.ui);
  const show = (agentBusy || agentReady) && screen !== "workshop";
  if (!show) return null;
  return (
    <div
      onClick={() => { dispatch(uiActions.agentClearReady()); dispatch(fx.nav("workshop", "modules")); }}
      style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 22px", borderBottom: `1px solid ${C.line}`, background: "#ffe6b3", animation: "scin .25s ease", cursor: "pointer" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {agentBusy ? (
          <Spinner color="#6B6212" track="#e6c265" />
        ) : (
          <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, flex: "0 0 auto", fill: "none", stroke: "#1F8A3B", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></svg>
        )}
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: C.bink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentReady ? L.agentReadyBar : agentStatus || L.agentWorking}</span>
      </span>
      <Chevron color="#9a8a3a" />
    </div>
  );
}

/* ---------- toast ---------- */
export function Toast() {
  const toast = useAppSelector((s) => s.ui.toast);
  if (!toast) return null;
  return (
    <div style={{ position: "absolute", left: "50%", bottom: 92, zIndex: 60, transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", gap: 8, background: C.ink, color: C.paper, fontFamily: "var(--mono)", fontSize: 11.5, padding: "10px 16px", borderRadius: 999, animation: "toastin .25s ease", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.signal }} />
      {toast}
    </div>
  );
}

/* ---------- bottom nav ---------- */
function NavItem({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{ flex: 1, background: "transparent", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "2px 0", position: "relative", color: active ? C.ink : C.mute }}>
      {active && <span style={{ position: "absolute", top: -8, width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: `5px solid ${C.signal}` }} />}
      <span style={{ width: 22, height: 22, display: "grid", placeItems: "center" }}>{children}</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</span>
    </button>
  );
}

const Ico = {
  mirror: <svg viewBox="0 0 24 24" style={icoStyle()}><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>,
  scenes: <svg viewBox="0 0 24 24" style={icoStyle()}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>,
  widgets: <svg viewBox="0 0 24 24" style={icoStyle()}><path d="M3 7c3-3 5 3 8 0s5 3 8 0M3 17c3-3 5 3 8 0s5 3 8 0" /></svg>,
  profiles: <svg viewBox="0 0 24 24" style={icoStyle()}><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.8 3.1-6 7-6s7 2.2 7 6" /></svg>,
  radar: <svg viewBox="0 0 24 24" style={icoStyle()}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></svg>,
  camera: <svg viewBox="0 0 24 24" style={icoStyle()}><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.5" /></svg>,
  comms: <svg viewBox="0 0 24 24" style={icoStyle()}><path d="M4 5h16v11H8l-4 4z" /></svg>,
};

function icoStyle(): React.CSSProperties {
  return { width: 21, height: 21, fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
}

export function BottomNav() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const tab = useAppSelector((s) => s.ui.tab);
  const devMode = useAppSelector((s) => s.dev.devMode);
  const screen = useAppSelector((s) => s.ui.screen);
  if (screen === "settings") return null;

  const go = (g: TabGroup) => dispatch(fx.goTab(g));
  const nav = (g: TabGroup, sc: "radar" | "camera" | "comms") => dispatch(fx.nav(sc, g));

  return (
    <div style={{ flex: "0 0 auto", display: "flex", padding: "12px 14px calc(12px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.line}`, background: C.paper }}>
      {devMode ? (
        <>
          <NavItem active={tab === "radar"} label={L.navRadar} onClick={() => nav("radar", "radar")}>{Ico.radar}</NavItem>
          <NavItem active={tab === "camera"} label={L.navCamera} onClick={() => nav("camera", "camera")}>{Ico.camera}</NavItem>
          <NavItem active={tab === "comms"} label={L.navComms} onClick={() => nav("comms", "comms")}>{Ico.comms}</NavItem>
        </>
      ) : (
        <>
          <NavItem active={tab === "home"} label={L.navMirror} onClick={() => go("home")}>{Ico.mirror}</NavItem>
          <NavItem active={tab === "scenes"} label={L.navLayouts} onClick={() => go("scenes")}>{Ico.scenes}</NavItem>
          <NavItem active={tab === "modules"} label={L.navModules} onClick={() => go("modules")}>{Ico.widgets}</NavItem>
          <NavItem active={tab === "profiles"} label={L.navProfiles} onClick={() => go("profiles")}>{Ico.profiles}</NavItem>
        </>
      )}
    </div>
  );
}

/* ---------- phone frame ---------- */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{ height: "100dvh", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px" }}>
      <div
        style={{
          width: "100%", maxWidth: 392, height: "min(844px, 96vh)", background: C.paper,
          borderRadius: 46, border: `1px solid var(--frame-border)`, boxShadow: "0 30px 80px -30px rgba(0,0,0,.45)",
          position: "relative", overflow: "hidden", display: "flex", flexDirection: "column",
          fontFamily: "var(--grotesk)", color: C.ink,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------- tiny shared svgs ---------- */
export function Spinner({ color, track, size = 13 }: { color: string; track: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, flex: "0 0 auto", animation: "mc-sweep .9s linear infinite" }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke={track} strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
export function Chevron({ color = "#8C8C81", size = 13 }: { color?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M9 6l6 6-6 6" /></svg>
  );
}
export function BackButton({ onClick, children }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button onClick={onClick} className="mc-lift" style={{ border: `1px solid ${C.ink}`, background: "transparent", borderRadius: 999, padding: "8px 14px", fontFamily: "var(--mono)", fontSize: 11, cursor: "pointer", color: C.ink }}>
      {children ?? "←"}
    </button>
  );
}

// re-export so screens can import profilesActions conveniently where needed
export { profilesActions };
