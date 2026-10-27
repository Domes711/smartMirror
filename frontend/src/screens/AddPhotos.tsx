import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BackButton } from "@/components/shell";
import { tokens as C } from "@/components/ui";
import { profilesActions } from "@/features/profiles/profilesSlice";
import * as fx from "@/app/thunks";

export default function AddPhotos() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const p = useAppSelector((s) => s.profiles);
  const isMirror = p.photoSource === "mirror";
  const session = p.sessionPhotos;

  const SourceRow = ({ src, title, sub, icon }: { src: "mirror" | "phone"; title: string; sub: string; icon: React.ReactNode }) => {
    const sel = p.photoSource === src;
    return (
      <button onClick={() => dispatch(profilesActions.setPhotoSource(src))} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 14, border: `1px solid ${sel ? C.ink : C.line}`, background: sel ? C.ink : C.p2, color: sel ? C.paper : C.ink, borderRadius: 16, padding: 16, cursor: "pointer", marginBottom: 12, transition: ".15s" }}>
        <span style={{ width: 42, height: 42, flex: "0 0 auto", borderRadius: 11, background: "rgba(140,140,129,.16)", display: "grid", placeItems: "center" }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: "block", fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{title}</b>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, opacity: 0.7 }}>{sub}</span>
        </span>
        <span style={{ width: 20, height: 20, flex: "0 0 auto", borderRadius: "50%", border: `1.5px solid ${sel ? C.paper : C.mute}`, display: "grid", placeItems: "center" }}>
          {sel && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "currentColor" }} />}
        </span>
      </button>
    );
  };

  const Session = () =>
    session.length > 0 ? (
      <>
        <p style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute, margin: "16px 0 8px" }}>{L.sessionTitle} · {session.length}</p>
        <div className="mc-noscroll" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 0 4px" }}>
          {session.map((ph) => (
            <button key={ph.id} onClick={() => dispatch(profilesActions.openPhotoSheet(ph.id))} style={{ position: "relative", flex: "0 0 auto", width: 60, height: 60, border: "none", borderRadius: 11, background: `linear-gradient(150deg, hsl(${ph.hue},34%,64%), hsl(${(ph.hue + 38) % 360},40%,40%))`, cursor: "pointer", overflow: "hidden", padding: 0 }}>
              {ph.src ? (
                <img src={ph.src} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <svg viewBox="0 0 24 24" style={{ position: "absolute", left: "50%", top: "54%", transform: "translate(-50%,-50%)", width: "46%", height: "46%", fill: "rgba(255,255,255,.34)" }}><circle cx="12" cy="8.4" r="4.1" /><path d="M4.5 20.5c0-4.2 3.4-6.6 7.5-6.6s7.5 2.4 7.5 6.6z" /></svg>
              )}
            </button>
          ))}
        </div>
      </>
    ) : null;

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
          <BackButton onClick={() => dispatch(fx.nav("profile", "profiles"))} />
          <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.01em", margin: 0 }}>{L.addPhotosTitle}</h2>
        </div>
        <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "10px 0 0" }}>{L.addPhotosHint}</p>
      </div>

      <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "16px 22px 0" }}>
        <SourceRow src="mirror" title={L.srcMirrorTitle} sub={L.srcMirrorSub} icon={<svg viewBox="0 0 24 24" style={ico()}><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.5" /></svg>} />
        <SourceRow src="phone" title={L.srcPhoneTitle} sub={L.srcPhoneSub} icon={<svg viewBox="0 0 24 24" style={ico()}><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>} />

        {isMirror ? (
          <>
            <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", borderRadius: 18, overflow: "hidden", background: "linear-gradient(160deg,#1f1f1b 0%,#14140f 100%)", border: "1px solid #2c2c26", display: "grid", placeItems: "center" }}>
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "46%", aspectRatio: "3 / 4", border: "2px dashed rgba(255,195,77,.5)", borderRadius: "44% 44% 42% 42%" }} />
              <span style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(233,232,221,.6)" }}>{L.camPreviewHint}</span>
              <span style={{ position: "absolute", top: 11, left: 12, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: C.signal }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.signal, animation: "mc-rec 1.4s steps(1) infinite" }} />live
              </span>
            </div>
            <Session />
          </>
        ) : (
          <Session />
        )}
      </div>

      <div style={{ flex: "0 0 auto", padding: "14px 0 18px", borderTop: `1px solid ${C.line}`, background: C.paper }}>
        {isMirror ? (
          <button onClick={() => dispatch(fx.takePhoto())} className="mc-lift" style={btn()}>
            <svg viewBox="0 0 24 24" style={ico(16)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.4" /></svg>{L.takePhoto}
          </button>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => dispatch(fx.shootPhoto())} className="mc-lift" style={{ ...btn(), flex: "0 0 auto" }}>
              <svg viewBox="0 0 24 24" style={ico(16)}><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.5" /></svg>{L.shootPhoto}
            </button>
            <button onClick={() => dispatch(fx.takePhoto())} className="mc-lift" style={{ ...btn(), flex: 1 }}>{L.choosePhotos}</button>
          </div>
        )}
        {session.length > 0 && (
          <button onClick={() => dispatch(fx.usePhotos())} className="mc-lift" style={{ ...btn(), marginTop: 10, background: C.ink, color: C.paper }}>
            <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M5 12.5l4.5 4.5L19 7" /></svg>{L.usePhotos} · {session.length}
          </button>
        )}
      </div>
    </section>
  );
}

function ico(size = 21): React.CSSProperties {
  return { width: size, height: size, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
}
function btn(): React.CSSProperties {
  return { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--mono)", fontSize: 12, letterSpacing: ".04em", borderRadius: 999, padding: "14px 18px", cursor: "pointer", border: `1px solid ${C.ink}`, background: "transparent", color: C.ink };
}
