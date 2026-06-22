import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { PillButton, tokens as C, h1 } from "@/components/ui";
import * as fx from "@/app/thunks";

export default function Profiles() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const profiles = useAppSelector((s) => s.profiles.profiles);

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ flex: "0 0 auto" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={h1}>{L.profilesTitle}</h1>
          <PillButton onClick={() => dispatch(fx.startWizard())}>
            <span style={{ fontFamily: "var(--grotesk)", fontWeight: 700, marginRight: 6 }}>+</span>{L.profileBtn}
          </PillButton>
        </div>
        <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "10px 0 16px" }}>{L.profilesHint}</p>
      </div>
      <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "6px 22px 28px" }}>
        {/* built-in default — always first, cannot be deleted */}
        <div onClick={() => dispatch(fx.openProfile("default"))} className="mc-lift" style={{ border: `1px solid ${C.line}`, borderRadius: 16, background: C.p2, padding: 16, cursor: "pointer", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <b style={{ fontSize: 18 }}>default</b>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: C.bink, background: C.butter, borderRadius: 999, padding: "3px 10px" }}>{L.defaultTag}</span>
          </div>
          <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, marginTop: 8 }}>{L.defaultRuns}</p>
        </div>

        {profiles.map((p) => (
          <div key={p.id} onClick={() => dispatch(fx.openProfile(p.name))} className="mc-lift" style={{ border: `1px solid ${C.line}`, borderRadius: 16, background: C.p2, padding: 16, cursor: "pointer", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <b style={{ fontSize: 18 }}>{p.name}</b>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute }}>{p.photos} {L.photosWord}</span>
            </div>
            <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, marginTop: 8 }}>{p.scenes} {L.scenesWord}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
