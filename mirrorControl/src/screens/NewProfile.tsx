import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BackButton } from "@/components/shell";
import { Mirror } from "@/components/Mirror";
import { tokens as C } from "@/components/ui";
import { profilesActions } from "@/features/profiles/profilesSlice";
import * as fx from "@/app/thunks";

export default function NewProfile() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const p = useAppSelector((s) => s.profiles);
  const scenes = useAppSelector((s) => s.scenes.scenes);
  const step = p.npStep;

  const sceneRows = Object.keys(scenes)
    .filter((id) => !/^default/i.test(scenes[id].use || ""))
    .map((id) => {
      const sc = scenes[id];
      const on = p.npScenes.includes(id);
      return { id, on, name: en && sc.name_en ? sc.name_en : sc.name, sub: sc.startLabel && sc.endLabel ? `${sc.startLabel}–${sc.endLabel}` : L.allDay, regions: sc.regions };
    });

  const back = () => (step > 1 ? dispatch(profilesActions.npBackStep()) : dispatch(fx.nav("profiles", "profiles")));

  const primary = (label: string, on: () => void, enabled: boolean) => (
    <button onClick={enabled ? on : undefined} style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: ".04em", borderRadius: 999, padding: "14px 18px", cursor: enabled ? "pointer" : "not-allowed", border: "none", background: enabled ? C.ink : "#C9C8BD", color: enabled ? C.paper : "#8C8C81" }}>{label}</button>
  );

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <BackButton onClick={back} />
          <div style={{ flex: 1, minWidth: 0 }}><h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.01em", margin: 0, lineHeight: 1.1 }}>{L.npTitle}</h2></div>
          <span style={{ flex: "0 0 auto", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: C.mute }}>{L.npStep} {step}/3</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <span style={{ flex: 1, height: 3, borderRadius: 999, background: C.ink }} />
          <span style={{ flex: 1, height: 3, borderRadius: 999, background: step >= 2 ? C.ink : C.line }} />
          <span style={{ flex: 1, height: 3, borderRadius: 999, background: step >= 3 ? C.ink : C.line }} />
        </div>
      </div>

      <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "16px 22px 0" }}>
        {step === 1 && (
          <>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>{L.npNameTitle}</h3>
            <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "0 0 16px" }}>{L.npNameHint}</p>
            <input value={p.npName} onChange={(e) => dispatch(profilesActions.setNpName(e.target.value))} placeholder={L.npNamePh} style={{ width: "100%", background: C.p3, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px", fontSize: 15, color: C.ink }} />
          </>
        )}
        {step === 2 && (
          <>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>{L.npPhotosTitle}</h3>
            <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "0 0 16px" }}>{L.npPhotosHint}</p>
            <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", borderRadius: 18, overflow: "hidden", background: "linear-gradient(160deg,#1f1f1b 0%,#14140f 100%)", border: "1px solid #2c2c26", display: "grid", placeItems: "center", marginBottom: 14 }}>
              <div style={{ width: "46%", aspectRatio: "3 / 4", border: "2px dashed rgba(255,195,77,.5)", borderRadius: "44% 44% 42% 42%" }} />
            </div>
            <button onClick={() => dispatch(profilesActions.npShoot())} className="mc-lift" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "14px 18px", cursor: "pointer", border: `1px solid ${C.ink}`, background: "transparent", color: C.ink }}>
              <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.7 }}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.4" /></svg>{L.npTakePhoto}
            </button>
            {p.npPhotos > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                {Array.from({ length: p.npPhotos }, (_, i) => (
                  <div key={i} style={{ width: 54, height: 54, borderRadius: 11, background: `linear-gradient(150deg, hsl(${(i * 47 + 18) % 360},34%,64%), hsl(${(i * 47 + 56) % 360},40%,40%))` }} />
                ))}
              </div>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>{L.npScenesTitle}</h3>
            <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "0 0 16px" }}>{L.npScenesHint}</p>
            {sceneRows.length === 0 ? (
              <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: C.mute }}>{L.npNoScenes}</p>
            ) : (
              sceneRows.map((r) => (
                <button key={r.id} onClick={() => dispatch(profilesActions.npToggleScene(r.id))} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 13, border: `1px solid ${r.on ? C.ink : C.line}`, background: r.on ? C.p2 : "transparent", borderRadius: 16, padding: 14, cursor: "pointer", marginBottom: 10 }}>
                  <div style={{ flex: "0 0 50px" }}><Mirror regions={r.regions} mode="thumb" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 15, fontWeight: 600 }}>{r.name}</b>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginTop: 3 }}>{r.sub}</div>
                  </div>
                  <span style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${r.on ? C.ink : C.line}`, background: r.on ? C.ink : "transparent", display: "grid", placeItems: "center", color: C.paper }}>{r.on ? "✓" : ""}</span>
                </button>
              ))
            )}
          </>
        )}
      </div>

      <div style={{ flex: "0 0 auto", padding: "14px 0 18px", borderTop: `1px solid ${C.line}`, background: C.paper, display: "flex", gap: 10 }}>
        {step === 1 && primary(L.npNext, () => p.npName.trim() && dispatch(profilesActions.setNpStep(2)), !!p.npName.trim())}
        {step === 2 && primary(L.npNext, () => dispatch(profilesActions.setNpStep(3)), p.npPhotos > 0)}
        {step === 3 && (
          <>
            <button onClick={() => dispatch(fx.finishWizard())} style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "14px 18px", cursor: "pointer", border: "none", background: C.ink, color: C.paper }}>{L.npSkip}</button>
            <button onClick={() => dispatch(fx.finishWizard())} style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "14px 18px", cursor: "pointer", border: "none", background: C.ink, color: C.paper }}>{L.npCreate}</button>
          </>
        )}
      </div>
    </section>
  );
}
