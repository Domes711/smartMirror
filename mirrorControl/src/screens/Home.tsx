import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { Mirror } from "@/components/Mirror";
import { MirrorStream } from "@/components/MirrorStream";
import { MirrorLoader } from "@/components/MirrorLoader";
import { PillButton, tokens as C, h1 } from "@/components/ui";
import * as fx from "@/app/thunks";
import { resolveActiveId } from "@/app/selectors";

export default function Home() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const en = useAppSelector((s) => s.ui.lang === "en");
  const homeLoading = useAppSelector((s) => s.ui.homeLoading);
  const scenes = useAppSelector((s) => s.scenes.scenes);
  // re-render on each clock tick so the resolved scene tracks the time of day
  useAppSelector((s) => s.ui.time);
  const connected = useAppSelector((s) => s.mirror.connected);
  const liveData = useAppSelector((s) => s.mirror.live);
  const mirrorLoading = useAppSelector((s) => s.mirror.loading);
  const activeId = resolveActiveId(scenes);
  const sc = scenes[activeId];
  const regions = sc?.regions ?? {};
  const liveCount = Object.values(regions).reduce((n, a) => n + (a?.length || 0), 0);
  const activeName = mirrorLoading ? "…" : sc ? (en && sc.name_en ? sc.name_en : sc.name) : "—";

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 2px", borderBottom: `1px solid ${C.line}` }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</span>
      {children}
    </div>
  );

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <h1 style={{ ...h1, marginBottom: 12, flex: "0 0 auto" }}>{L.navMirror}</h1>
      <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "6px 22px 28px" }}>
        <div style={{ position: "relative" }}>
          {homeLoading ? (
            <MirrorLoader aspect={false} height="48dvh" />
          ) : (
            <div style={{ position: "relative", animation: "mc-fade .45s ease" }}>
              {/* real mirror when connected, synthetic preview as offline fallback */}
              {connected ? <MirrorStream /> : <Mirror regions={regions} mode="preview" />}
              <div style={{ position: "absolute", top: 14, right: 14, display: "flex", alignItems: "center", gap: 6, background: "rgba(26,26,23,.55)", border: "1px solid rgba(229,72,47,.5)", borderRadius: 999, padding: "4px 9px", backdropFilter: "blur(2px)" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.signal }} />
                <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: C.signal }}>{L.live}</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 16 }}>
          <PillButton full onClick={() => dispatch(fx.editResolved("home"))}>{L.editLayout}</PillButton>
          <PillButton variant="outline" onClick={() => dispatch(fx.wake())}>{L.wake}</PillButton>
        </div>

        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em", color: C.ink, margin: "18px 0 6px" }}>{L.currentInfo}</p>
          <Row label={L.activeScene}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, background: C.butter, color: C.bink, padding: "4px 12px", borderRadius: 999 }}>{activeName}</span>
          </Row>
          <Row label={L.profile}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{L.defaultTag}</span>
          </Row>
          <Row label={L.connection}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: connected ? C.green : C.signal }}>
              ● {connected ? `${L.online}${liveData ? "" : " · sync…"}` : (en ? "offline" : "offline")}
            </span>
          </Row>
          <Row label={L.modsRunning}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{liveCount}</span>
          </Row>
        </div>
      </div>
    </section>
  );
}
