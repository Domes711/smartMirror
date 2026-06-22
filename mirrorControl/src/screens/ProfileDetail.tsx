import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BackButton } from "@/components/shell";
import { Calendar, useSceneCards } from "@/components/Calendar";
import { PillButton, tokens as C, h2 } from "@/components/ui";
import { profilesActions } from "@/features/profiles/profilesSlice";
import * as fx from "@/app/thunks";

export default function ProfileDetail() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const p = useAppSelector((s) => s.profiles);
  const tempActive = p.tempActiveProfile === p.profileName;
  const isDefault = p.profileName === "default";
  const planCards = useSceneCards({ onOpen: (id) => dispatch(fx.editScene(id, "profile")), scheduledOnly: true });

  const Tab = ({ on, label, sel }: { on: () => void; label: string; sel: boolean }) => (
    <button onClick={on} style={{ border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: ".05em", textTransform: "uppercase", padding: "0 1px 11px", marginBottom: -1, color: sel ? C.ink : C.mute, borderBottom: `2px solid ${sel ? C.ink : "transparent"}` }}>{label}</button>
  );

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
          <BackButton onClick={() => dispatch(fx.nav("profiles", "profiles"))}>← {L.profilesTitle}</BackButton>
          <h2 style={h2}>{p.profileName}</h2>
        </div>
        <div style={{ display: "flex", gap: 22, borderBottom: `1px solid ${C.line}`, margin: "31px 0 4px" }}>
          <Tab on={() => dispatch(profilesActions.setProfileTab("scenes"))} label={L.profScenes} sel={p.profileTab === "scenes"} />
          <Tab on={() => dispatch(profilesActions.setProfileTab("face"))} label={L.faceRecog} sel={p.profileTab === "face"} />
          <Tab on={() => dispatch(profilesActions.setProfileTab("settings"))} label={L.profSettingsTab} sel={p.profileTab === "settings"} />
        </div>

        {p.profileTab === "scenes" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "10px 0 15px" }}>
            <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.5, margin: 0 }}>{L.profScenesHint}</p>
            <PillButton onClick={() => dispatch(fx.openNewScene())} style={{ flex: "0 0 auto", padding: "11px 17px" }}>
              <span style={{ fontFamily: "var(--grotesk)", fontWeight: 700, marginRight: 6 }}>+</span>{L.sceneBtn}
            </PillButton>
          </div>
        )}

        {p.profileTab === "face" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "14px 0 15px" }}>
              <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.5, margin: 0 }}>{isDefault ? L.faceDesc : L.faceHint}</p>
              <PillButton onClick={() => dispatch(fx.openAddPhotos())} style={{ flex: "0 0 auto", padding: "11px 17px" }}>
                <span style={{ fontFamily: "var(--grotesk)", fontWeight: 700, marginRight: 6 }}>+</span>{L.addPhotos}
              </PillButton>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, margin: "6px 0 12px" }}>
              <p style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute, margin: 0 }}>{L.photosTitle}</p>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>{p.facePhotos.length}</span>
            </div>
          </>
        )}
      </div>

      {p.profileTab === "scenes" && (
        <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "2px 22px 24px" }}>
          <Calendar cards={planCards} />
        </div>
      )}

      {p.profileTab === "face" && (
        <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "2px 22px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
            {p.facePhotos.map((ph) => (
              <button key={ph.id} onClick={() => dispatch(profilesActions.openPhotoSheet(ph.id))} style={{ position: "relative", aspectRatio: "1", border: "none", borderRadius: 12, background: `linear-gradient(150deg, hsl(${ph.hue},34%,64%), hsl(${(ph.hue + 38) % 360},40%,40%))`, cursor: "pointer", overflow: "hidden", padding: 0 }}>
                <svg viewBox="0 0 24 24" style={{ position: "absolute", left: "50%", top: "54%", transform: "translate(-50%,-50%)", width: "46%", height: "46%", fill: "rgba(255,255,255,.34)" }}><circle cx="12" cy="8.4" r="4.1" /><path d="M4.5 20.5c0-4.2 3.4-6.6 7.5-6.6s7.5 2.4 7.5 6.6z" /></svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {p.profileTab === "settings" && (
        <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "18px 22px 24px" }}>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 16, background: C.p2, padding: 16, marginBottom: 14 }}>
            <b style={{ fontSize: 15, fontWeight: 600, display: "block", marginBottom: 5 }}>{L.tempActivateTitle}</b>
            <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "0 0 14px" }}>{L.tempActivateDesc}</p>
            <button onClick={() => dispatch(fx.toggleTempActive())} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 12, letterSpacing: ".04em", borderRadius: 999, padding: "12px 18px", cursor: "pointer", background: tempActive ? C.butter : "transparent", color: tempActive ? C.bink : C.ink, border: `1px solid ${tempActive ? C.bline : C.ink}` }}>
              <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M13 2L4.5 13.5H12l-1 8.5L19.5 10.5H12z" /></svg>
              {tempActive ? L.tempActiveOn : L.tempActivate}
            </button>
          </div>

          {!isDefault && (
            <div style={{ border: "1px solid rgba(229,72,47,.3)", borderRadius: 16, background: "rgba(229,72,47,.05)", padding: 16 }}>
              <b style={{ fontSize: 15, fontWeight: 600, display: "block", marginBottom: 5 }}>{L.deleteProfileTitle}</b>
              <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "0 0 14px" }}>{L.deleteProfileDesc}</p>
              <button onClick={() => dispatch(profilesActions.openProfileDel())} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 12, letterSpacing: ".04em", borderRadius: 999, padding: "12px 18px", cursor: "pointer", background: "transparent", color: C.signal, border: `1px solid ${C.signal}` }}>
                <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" /></svg>
                {L.deleteProfileBtn}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
