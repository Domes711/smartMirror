import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { MiniThumb } from "@/components/MiniThumb";
import { BackButton, Spinner } from "@/components/shell";
import { tokens as C } from "@/components/ui";
import { modulesActions } from "@/features/modules/modulesSlice";
import * as fx from "@/app/thunks";

export default function ModuleDetail() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const detail = useAppSelector((s) => s.modules.detailMod);
  const installed = useAppSelector((s) => s.modules.installed);
  const task = useAppSelector((s) => s.ui);
  if (!detail) return null;

  const isInstalled = detail.installed ?? installed.includes(detail.n);
  const installing = task.taskKind === "install" && task.taskTarget === detail.n;
  const canInstall = !isInstalled && !installing;
  const showHint = isInstalled && !detail.own;

  return (
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <BackButton onClick={() => dispatch(fx.nav("modules", "modules"))}>← {L.navModules}</BackButton>
        <div>
          <h2 style={{ fontSize: 20, lineHeight: 1.1, fontWeight: 600, margin: 0 }}>{detail.c}</h2>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute }}>{detail.n}</span>
        </div>
      </div>

      <div style={{ background: C.ink, color: C.paper, borderRadius: 14, padding: 18, marginTop: 16, minHeight: 120 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "#a9a89d" }}>{L.preview}</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.signal }}>● {L.live}</span>
        </div>
        <div style={{ marginTop: 14 }}><MiniThumb m={detail} /></div>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "16px 0" }}>
        {detail.t.map((t) => <span key={t} style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.mute, border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}>{t}</span>)}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {isInstalled && (
          <>
            <button onClick={() => detail.own ? dispatch(fx.openWorkshop(detail.n)) : dispatch(fx.openWorkshop(detail.n))} style={btn(true)}>{L.edit}</button>
            <button onClick={() => detail.own ? dispatch(modulesActions.openDeleteMod(detail.n)) : dispatch(modulesActions.openUninstall(detail.n))} style={{ ...btn(false), borderColor: C.signal, color: C.signal, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" /></svg>
              {detail.own ? L.delModBtn : L.remove}
            </button>
          </>
        )}
        {canInstall && (
          <button onClick={() => dispatch(fx.startInstall(detail.n))} className="mc-lift" style={{ ...btn(true), display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            {L.install}
          </button>
        )}
        {installing && (
          <div style={{ flex: 1, position: "relative", overflow: "hidden", borderRadius: 999, border: `1px solid ${C.signal}`, background: "transparent", padding: "12px 18px" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${task.taskPct}%`, background: "rgba(229,72,47,.18)", transition: "width .4s ease" }} />
            <span style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 12, color: C.ink }}>
              <Spinner color="#E5482F" track="#f3c9c0" size={14} />
              {L.installing} · {Math.round(task.taskPct)}%
            </span>
          </div>
        )}
      </div>
      {showHint && <p style={{ fontFamily: "var(--mono)", fontSize: 10.5, lineHeight: 1.5, color: C.mute, margin: "9px 2px 0" }}>{L.removeHint}</p>}

      <p style={{ fontSize: 14, lineHeight: 1.6, color: C.ink2, marginTop: 16 }}>{detail.d}</p>
    </section>
  );
}

function btn(solid: boolean): React.CSSProperties {
  return { flex: 1, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "12px 18px", cursor: "pointer", border: `1px solid ${C.ink}`, background: solid ? C.ink : "transparent", color: solid ? C.paper : C.ink };
}
