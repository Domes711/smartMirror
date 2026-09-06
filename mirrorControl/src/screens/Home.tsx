import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BottomSheet, PillButton, Segmented, eyebrow, tokens as C, h1 } from "@/components/ui";
import * as fx from "@/app/thunks";
import { resolveActiveId } from "@/app/selectors";
import { mirrorDisplayUrl } from "@/services/api";
import { isConnected } from "@/services/mqtt";

/* ---------- quick-action icons ---------- */
const ico: CSSProperties = { width: 20, height: 20, fill: "none", stroke: C.paper, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };

const Icons = {
  wake: (
    <svg viewBox="0 0 24 24" style={ico}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9" />
    </svg>
  ),
  scene: (
    <svg viewBox="0 0 24 24" style={ico}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M14.5 5.5l4 4" />
    </svg>
  ),
  message: (
    <svg viewBox="0 0 24 24" style={ico}>
      <path d="M4 5h16v11H8l-4 4z" />
    </svg>
  ),
  widget: (
    <svg viewBox="0 0 24 24" style={ico}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
};

/** Duration presets for a note shown on the mirror (ms). */
const DURATIONS = [
  { value: 60_000, label: "1 min" },
  { value: 600_000, label: "10 min" },
  { value: 3_600_000, label: "1 h" },
];

function mirrorHost(): string {
  try {
    return new URL(mirrorDisplayUrl()).hostname;
  } catch {
    return typeof location !== "undefined" ? location.hostname : "—";
  }
}

export default function Home() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const en = useAppSelector((s) => s.ui.lang === "en");
  const scenes = useAppSelector((s) => s.scenes.scenes);
  // re-render on each clock tick so the resolved scene tracks the time of day
  useAppSelector((s) => s.ui.time);
  const connected = useAppSelector((s) => s.mirror.connected);
  const liveData = useAppSelector((s) => s.mirror.live);
  const mirrorLoading = useAppSelector((s) => s.mirror.loading);
  const profileKeys = useAppSelector((s) => s.mirror.profileKeys);
  const currentUserKey = useAppSelector((s) => s.mirror.currentUserKey);

  const activeId = resolveActiveId(scenes);
  const sc = scenes[activeId];
  const regions = sc?.regions ?? {};
  const liveCount = Object.values(regions).reduce((n, a) => n + (a?.length || 0), 0);
  const activeName = mirrorLoading ? "…" : sc ? (en && sc.name_en ? sc.name_en : sc.name) : "—";
  const profileName =
    currentUserKey === "default"
      ? (L.defaultTag as string)
      : Object.keys(profileKeys).find((n) => profileKeys[n] === currentUserKey) || currentUserKey;

  // "Poslat vzkaz" composer
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [msgTimer, setMsgTimer] = useState(DURATIONS[1].value);

  const sendMessage = () => {
    if (!msgText.trim()) return;
    dispatch(fx.sendMirrorMessage(msgText, msgTimer));
    setMsgText("");
    setMsgOpen(false);
  };

  const ActionCard = ({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      className="mc-lift"
      style={{
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14,
        background: C.p2, border: `1px solid ${C.line}`, borderRadius: 16,
        padding: "16px 16px 18px", cursor: "pointer", textAlign: "left", color: C.ink,
      }}
    >
      <span style={{ width: 42, height: 42, borderRadius: 12, background: C.ink, display: "grid", placeItems: "center", flex: "0 0 auto" }}>
        {icon}
      </span>
      <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>{label}</span>
    </button>
  );

  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 2px", borderBottom: `1px solid ${C.line}` }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</span>
      {children}
    </div>
  );

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <h1 style={{ ...h1, marginBottom: 16, flex: "0 0 auto" }}>{L.navMirror}</h1>

      <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "0 22px calc(env(safe-area-inset-bottom) + 18px)" }}>
        <p style={{ ...eyebrow, margin: "0 0 10px" }}>{L.quickActions}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 22 }}>
          <ActionCard icon={Icons.wake} label={L.wake as string} onClick={() => dispatch(fx.wake())} />
          <ActionCard icon={Icons.scene} label={L.editLayout as string} onClick={() => dispatch(fx.editResolved("home"))} />
          <ActionCard icon={Icons.message} label={L.sendMessage as string} onClick={() => setMsgOpen(true)} />
          <ActionCard icon={Icons.widget} label={L.newWidget as string} onClick={() => dispatch(fx.goTab("modules"))} />
        </div>

        <p style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em", color: C.ink, margin: "0 0 6px" }}>{L.currentInfo}</p>
        <Row label={L.activeScene as string}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13, background: C.butter, color: C.bink, padding: "4px 12px", borderRadius: 999 }}>{activeName}</span>
        </Row>
        <Row label={L.profile as string}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{profileName}</span>
        </Row>
        <Row label={L.connection as string}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: connected ? C.green : C.signal }}>
            ● {connected ? `${liveData ? L.online : L.syncing} · ${mirrorHost()}` : L.offline}
          </span>
        </Row>
        <Row label={L.modsRunning as string}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{liveCount}</span>
        </Row>
      </div>

      <BottomSheet open={msgOpen} onClose={() => setMsgOpen(false)}>
        <p style={{ ...eyebrow, margin: "0 0 4px" }}>{L.msgTitle}</p>
        <p style={{ fontSize: 13, color: C.ink2, margin: "0 0 14px" }}>{L.msgHint}</p>

        <textarea
          value={msgText}
          onChange={(e) => setMsgText(e.target.value)}
          placeholder={L.msgPh as string}
          rows={3}
          autoFocus
          style={{
            width: "100%", boxSizing: "border-box", resize: "none",
            border: `1px solid ${C.line}`, borderRadius: 12, background: C.p3,
            padding: "12px 14px", fontFamily: "var(--grotesk)", fontSize: 15, color: C.ink,
          }}
        />

        <p style={{ ...eyebrow, margin: "14px 0 7px" }}>{L.msgDuration}</p>
        <Segmented options={DURATIONS} value={msgTimer} onChange={setMsgTimer} />

        {!isConnected() && (
          <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.signal, margin: "14px 0 0" }}>{L.msgOffline}</p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <PillButton variant="outline" onClick={() => setMsgOpen(false)}>{L.cancel}</PillButton>
          <PillButton full onClick={sendMessage} style={{ opacity: msgText.trim() ? 1 : 0.45 }}>{L.msgSend}</PillButton>
        </div>
      </BottomSheet>
    </section>
  );
}
