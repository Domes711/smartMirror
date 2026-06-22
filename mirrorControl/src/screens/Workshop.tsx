import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BackButton, Spinner } from "@/components/shell";
import { Segmented, Toggle, tokens as C } from "@/components/ui";
import { modulesActions } from "@/features/modules/modulesSlice";
import * as fx from "@/app/thunks";

export default function Workshop() {
  const dispatch = useAppDispatch();
  const { L, en, raw } = useT();
  const m = useAppSelector((s) => s.modules);
  const ui = useAppSelector((s) => s.ui);
  const chatRef = useRef<HTMLDivElement>(null);

  const installing = ui.taskKind === "install" && ui.taskTarget === m.workshopMod;
  const isInstalled = m.installed.includes(m.workshopMod) && !installing && !m.wsEditing;
  const canInstall = !installing && (!m.installed.includes(m.workshopMod) || m.wsEditing);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [m.chat.length, ui.agentBusy, m.ctrlFormOpen]);

  const back = () => {
    const done = installing || (m.installed.includes(m.workshopMod) && !m.wsEditing);
    if (done) dispatch(fx.nav("modules", "modules"));
    else dispatch(modulesActions.openWsBack());
  };

  const reminders = [
    { t: en ? "Pay the rent" : "Zaplatit nájem", imp: true },
    { t: en ? "Submit Q2 report" : "Odevzdat report", imp: true },
    { t: en ? "Buy milk" : "Koupit mléko", imp: false },
    { t: en ? "Call the doctor" : "Zavolat doktorovi", imp: false },
    { t: en ? "Pick up parcel" : "Vyzvednout balík", imp: true },
    { t: en ? "Water the plants" : "Zalít kytky", imp: false },
    { t: en ? "Meeting 15:00" : "Schůzka 15:00", imp: true },
  ];
  const previewList = (m.wsImportantOnly ? reminders.filter((r) => r.imp) : reminders).slice(0, m.wsMaxCount);

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
        <BackButton onClick={back} />
        <h2 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>{m.workshopMod}</h2>
        {canInstall && (
          <button onClick={() => dispatch(fx.wsInstallNow())} className="mc-lift" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--mono)", fontSize: 11, borderRadius: 999, padding: "9px 14px", cursor: "pointer", border: `1px solid ${C.ink}`, background: C.ink, color: C.paper }}>
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            {L.toMirror}
          </button>
        )}
        {installing && (
          <div style={{ marginLeft: "auto", position: "relative", overflow: "hidden", borderRadius: 999, border: `1px solid ${C.ink}`, padding: "9px 14px", minWidth: 130, background: "transparent" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${ui.taskPct}%`, background: "rgba(26,26,23,.14)", transition: "width .4s ease" }} />
            <span style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
              <Spinner color="#1A1A17" track="#CFCEC2" /> {L.installing} · {Math.round(ui.taskPct)}%
            </span>
          </div>
        )}
        {isInstalled && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: 11, borderRadius: 999, padding: "9px 14px", border: `1px solid ${C.bline}`, color: C.bink, background: C.bsoft }}>
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M5 12.5l4.5 4.5L19 7" /></svg>{L.installed}
          </span>
        )}
      </div>

      <div style={{ flex: "0 0 auto", marginBottom: 16 }}>
        <Segmented
          options={[{ value: "chat", label: L.tabChat }, { value: "preview", label: L.tabPreview }]}
          value={m.workshopTab}
          onChange={(v) => dispatch(modulesActions.setWorkshopTab(v))}
        />
      </div>

      {m.workshopTab === "chat" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div ref={chatRef} className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, margin: "0 -22px", padding: "0 22px 14px" }}>
            {m.chat.map((c, i) => {
              const me = c.role === "me";
              return (
                <div key={i} style={{ maxWidth: "88%", display: "flex", flexDirection: "column", fontSize: 14, lineHeight: 1.5, alignSelf: me ? "flex-end" : "flex-start", background: me ? C.ink : C.bsoft, color: me ? C.paper : C.ink, padding: "11px 14px", borderRadius: me ? "14px 14px 4px 14px" : "14px 14px 14px 4px" }}>
                  {!me && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase", color: C.bink, marginBottom: 5 }}>
                      <svg viewBox="0 0 24 24" fill={C.bink} style={{ width: 13, height: 13 }}><path d="M10 2a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 3 0V4a2 2 0 0 1 4 0v3h1.5a1.5 1.5 0 0 1 0 3H19v4h1.5a1.5 1.5 0 0 1 0 3H19v1a2 2 0 0 1-2 2h-3v-1.5a1.5 1.5 0 0 0-3 0V22H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2a1.5 1.5 0 0 0 0-3H4V7a2 2 0 0 1 2-2h2V4a2 2 0 0 1 2-2Z" /></svg>
                      {L.aiAgent}
                    </span>
                  )}
                  <span>{c.text}</span>
                </div>
              );
            })}
            {m.ctrlFormOpen && <CtrlForm />}
            {ui.agentBusy && (
              <div style={{ alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 10, padding: "9px 16px", border: `1px solid ${C.line}`, borderRadius: 999, background: C.p2, animation: "scin .26s ease" }}>
                <Spinner color="#6B6212" track="#D8D7CB" size={15} />
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.bink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ui.agentStatus || L.agentWorking}</span>
              </div>
            )}
          </div>

          <div className="mc-noscroll" style={{ flex: "0 0 auto", display: "flex", gap: 8, margin: "12px 0", overflowX: "auto" }}>
            {(raw.wsSuggest as string[]).map((sgg) => (
              <button key={sgg} onClick={() => dispatch(fx.agentSend(sgg))} className="mc-lift" style={{ flex: "0 0 auto", whiteSpace: "nowrap", fontFamily: "var(--mono)", fontSize: 11, border: `1px solid ${C.line}`, borderRadius: 999, padding: "7px 12px", cursor: "pointer", background: "transparent", color: C.mute }}>{sgg}</button>
            ))}
          </div>

          <div style={{ flex: "0 0 auto", display: "flex", gap: 10, alignItems: "center", borderTop: `1px solid ${C.line}`, padding: "14px 0 18px" }}>
            <input
              value={m.chatDraft}
              onChange={(e) => dispatch(modulesActions.setChatDraft(e.target.value))}
              onKeyDown={(e) => { if (e.key === "Enter") dispatch(fx.agentSend()); }}
              placeholder={L.wsComposer}
              style={{ flex: 1, background: C.p3, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", fontSize: 13, color: C.ink }}
            />
            <button onClick={() => dispatch(fx.agentSend())} style={{ width: 46, height: 46, flex: "0 0 46px", borderRadius: "50%", border: `1px solid ${C.ink}`, background: C.ink, cursor: "pointer", display: "grid", placeItems: "center" }}>
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: C.paper }}><path d="M3 11l18-8-8 18-2-7-8-3z" /></svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "0 22px 18px" }}>
          <div style={{ background: C.ink, borderRadius: 14, padding: 24, minHeight: 266, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
            <span style={{ position: "absolute", top: 14, left: 16, fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "#a9a89d" }}>{L.preview}</span>
            <span style={{ position: "absolute", top: 14, right: 16, fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.signal }}>● {L.live}</span>
            <div style={{ width: "100%", marginTop: 18, fontFamily: "var(--mono)", color: C.paper, textAlign: "left" }}>
              <div style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "#8e8d83", marginBottom: 12 }}>{en ? "Reminders" : "Připomínky"}</div>
              {previewList.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? "1px solid rgba(233,232,221,.1)" : "none" }}>
                  <span style={{ color: r.imp ? C.signal : "#6f6e66", fontSize: 13, flex: "0 0 auto", lineHeight: 1 }}>{r.imp ? "★" : "○"}</span>
                  <span style={{ fontSize: 14, color: r.imp ? C.paper : "#b9b8ad" }}>{r.t}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: C.p2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginTop: 14 }}>
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute, margin: "0 0 4px" }}>{L.ctrlTitle}</p>
              <p style={{ fontSize: 13, lineHeight: 1.45, color: C.ink2, margin: 0 }}>{L.ctrlHint}</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13.5, color: C.ink }}>{L.ctrlImportant}</span>
              <Toggle on={m.wsImportantOnly} onClick={() => dispatch(modulesActions.toggleWsImportant())} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13.5, color: C.ink }}>{L.ctrlMax}</span>
              <Segmented options={[3, 5, 8].map((n) => ({ value: n, label: String(n) }))} value={m.wsMaxCount} onChange={(v) => dispatch(modulesActions.setWsMax(v))} size="sm" />
            </div>
            <button onClick={() => dispatch(fx.addCtrl())} className="mc-lift" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "11px 18px", cursor: "pointer", border: "1px dashed #B7B6AA", background: "transparent", color: C.mute }}>
              <span style={{ fontFamily: "var(--grotesk)", fontWeight: 700, fontSize: 15, lineHeight: 1 }}>+</span>{L.addCtrl}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CtrlForm() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const m = useAppSelector((s) => s.modules);
  return (
    <div style={{ alignSelf: "flex-start", width: "92%", background: C.p2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, animation: "scin .26s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: C.ink }}>{L.ctrlFormTitle}</span>
      </div>
      <label style={lbl}>{L.cfQ1}</label>
      <input value={m.ctrlWhat} onChange={(e) => dispatch(modulesActions.setCtrlWhat(e.target.value))} placeholder={L.cfQ1Ph} style={fld} />
      <label style={lbl}>{L.cfQ2}</label>
      <div style={{ marginBottom: 14 }}>
        <Segmented
          options={[{ value: "toggle", label: L.cfTypeToggle }, { value: "select", label: L.cfTypeSelect }, { value: "slider", label: L.cfTypeSlider }]}
          value={m.ctrlType}
          onChange={(v) => dispatch(modulesActions.setCtrlType(v))}
        />
      </div>
      <label style={lbl}>{L.cfQ3}</label>
      <input value={m.ctrlDefault} onChange={(e) => dispatch(modulesActions.setCtrlDefault(e.target.value))} placeholder={L.cfQ3Ph} style={fld} />
      <button onClick={() => dispatch(fx.submitCtrlForm())} style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "11px 18px", cursor: "pointer", border: `1px solid ${C.ink}`, background: C.ink, color: C.paper }}>{L.cfSubmit}</button>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontFamily: "var(--mono)", fontSize: 10.5, color: C.mute, marginBottom: 6 };
const fld: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.p3, border: `1px solid ${C.line}`, borderRadius: 11, padding: "11px 13px", fontSize: 13.5, color: C.ink, marginBottom: 14 };
