import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { MiniThumb } from "@/components/MiniThumb";
import { BackButton } from "@/components/shell";
import { tokens as C } from "@/components/ui";
import { modulesActions } from "@/features/modules/modulesSlice";
import * as fx from "@/app/thunks";
import * as ai from "@/app/ai";

export default function CreateModule() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const m = useAppSelector((s) => s.modules);
  const aiOn = useAppSelector((s) => s.mirror.live && s.modules.aiAvailable);
  const isNew = m.createTab !== "drafts";
  const draftCount = aiOn ? m.serverDrafts?.length ?? 0 : m.drafts.length;

  useEffect(() => {
    if (aiOn && !isNew) dispatch(ai.refreshDrafts());
  }, [aiOn, isNew, dispatch]);

  const input = (val: string, on: (v: string) => void, ph: string, ta?: boolean) =>
    ta ? (
      <textarea value={val} onChange={(e) => on(e.target.value)} placeholder={ph} style={{ width: "100%", minHeight: 90, background: C.p3, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 14px", fontSize: 14, color: C.ink, resize: "none" }} />
    ) : (
      <input value={val} onChange={(e) => on(e.target.value)} placeholder={ph} style={{ width: "100%", background: C.p3, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 14px", fontSize: 14, color: C.ink }} />
    );

  const Tab = ({ on, label, sel }: { on: () => void; label: string; sel: boolean }) => (
    <button onClick={on} style={{ border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".04em", textTransform: "uppercase", padding: "0 1px 11px", marginBottom: -1, color: sel ? C.ink : C.mute, borderBottom: `2px solid ${sel ? C.ink : "transparent"}`, whiteSpace: "nowrap" }}>{label}</button>
  );

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <BackButton onClick={() => dispatch(fx.nav("modules", "modules"))} />
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{L.newModule}</h2>
      </div>
      <p style={{ flex: "0 0 auto", fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "8px 0 0" }}>{L.newModuleHint}</p>

      <div style={{ flex: "0 0 auto", display: "flex", gap: 20, borderBottom: `1px solid ${C.line}`, margin: "14px 0 18px" }}>
        <Tab on={() => dispatch(modulesActions.setCreateTab("new"))} label={L.createSecNew} sel={isNew} />
        <Tab on={() => dispatch(modulesActions.setCreateTab("drafts"))} label={`${L.createSecDrafts} · ${draftCount}`} sel={!isNew} />
      </div>

      <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "6px 22px 28px" }}>
        {isNew ? (
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 16, background: C.p2, padding: 16 }}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 7, textTransform: "uppercase", letterSpacing: ".08em" }}>{L.modName}</label>
              {input(m.createName, (v) => dispatch(modulesActions.setCreateName(v)), L.modNamePh)}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 7, textTransform: "uppercase", letterSpacing: ".08em" }}>{L.modDo}</label>
              {input(m.createDesc, (v) => dispatch(modulesActions.setCreateDesc(v)), L.modDoPh, true)}
            </div>
            <button onClick={() => dispatch(aiOn ? ai.aiCreateAndOpen() : fx.doCreate())} style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "12px 18px", cursor: "pointer", border: `1px solid ${C.ink}`, background: C.ink, color: C.paper }}>{L.createContinue}</button>
          </div>
        ) : aiOn ? (
          m.serverDrafts && m.serverDrafts.length ? (
            m.serverDrafts.map((d) => (
              <div key={d.name} onClick={() => dispatch(ai.openAiWorkshop(d.name, "draft"))} className="mc-lift" style={{ border: `1px solid ${C.line}`, borderRadius: 16, background: C.p2, padding: 16, marginBottom: 14, cursor: "pointer", display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ flex: "0 0 70px", height: 70, borderRadius: 10, background: C.ink, display: "grid", placeItems: "center", border: `1px solid ${C.ink}`, overflow: "hidden" }}><MiniThumb m={{ mini: [d.name.replace(/^MMM-/, "").slice(0, 8).toUpperCase()] }} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, lineHeight: 1.2, overflowWrap: "anywhere" }}>{d.name}</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "3px 0 5px" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: C.bink, background: C.bsoft, border: `1px solid ${C.bline}`, borderRadius: 999, padding: "3px 9px" }}>{L.draftBadge}</span>
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.4, color: C.ink2, margin: 0 }}>{d.description || ""}</p>
                </div>
              </div>
            ))
          ) : (
            <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: C.mute, lineHeight: 1.6, padding: "6px 0 20px" }}>{L.draftsEmpty}</p>
          )
        ) : m.drafts.length ? (
          m.drafts.map((d) => (
            <div key={d.n} onClick={() => dispatch(fx.openWorkshop(d.n, true))} className="mc-lift" style={{ border: `1px solid ${C.line}`, borderRadius: 16, background: C.p2, padding: 16, marginBottom: 14, cursor: "pointer", display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ flex: "0 0 70px", height: 70, borderRadius: 10, background: C.ink, display: "grid", placeItems: "center", border: `1px solid ${C.ink}`, overflow: "hidden" }}><MiniThumb m={d} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, lineHeight: 1.2, overflowWrap: "anywhere" }}>{en ? d.ce : d.c}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "3px 0 5px" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>{d.n}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: C.bink, background: C.bsoft, border: `1px solid ${C.bline}`, borderRadius: 999, padding: "3px 9px" }}>{L.draftBadge}</span>
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.4, color: C.ink2, margin: 0 }}>{en ? d.de : d.d}</p>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 9 }}>
                  {(en ? d.te : d.t).map((t) => <span key={t} style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.mute, border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}>{t}</span>)}
                </div>
              </div>
            </div>
          ))
        ) : (
          <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: C.mute, lineHeight: 1.6, padding: "6px 0 20px" }}>{L.draftsEmpty}</p>
        )}
      </div>
    </section>
  );
}
