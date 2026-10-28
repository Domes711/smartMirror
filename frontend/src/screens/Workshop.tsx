import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BackButton, Spinner } from "@/components/shell";
import { Segmented, tokens as C } from "@/components/ui";
import { modulesActions } from "@/features/modules/modulesSlice";
import * as fx from "@/app/thunks";
import * as ai from "@/app/ai";
import { aiDraftZipUrl } from "@/app/api/aiModulesApi";

export default function Workshop() {
  const dispatch = useAppDispatch();
  const { L, raw } = useT();
  const m = useAppSelector((s) => s.modules);
  const ui = useAppSelector((s) => s.ui);
  const chatRef = useRef<HTMLDivElement>(null);

  const installing = ui.taskKind === "install" && ui.taskTarget === m.workshopMod;
  const isInstalled = m.installed.includes(m.workshopMod) && !installing && !m.wsEditing;
  const canInstall = !installing && (!m.installed.includes(m.workshopMod) || m.wsEditing);
  const streaming = m.aiStreaming;
  const send = (t?: string) => dispatch(ai.aiSend(t));
  const lastBot = m.chat[m.chat.length - 1]?.role === "bot" ? m.chat[m.chat.length - 1].text : "";

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [m.chat.length, lastBot, streaming]);

  // AI drafts are persisted server-side — just leave (install via the button)
  const back = () => dispatch(fx.nav("modules", "modules"));

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
        <BackButton onClick={back} />
        <h2 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>{m.workshopMod}</h2>
        {canInstall && (
          <button onClick={() => dispatch(ai.aiInstall())} className="mc-lift" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--mono)", fontSize: 11, borderRadius: 999, padding: "9px 14px", cursor: "pointer", border: `1px solid ${C.ink}`, background: C.ink, color: C.paper }}>
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
            {streaming && (
              <div style={{ alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 10, padding: "9px 16px", border: `1px solid ${C.line}`, borderRadius: 999, background: C.p2, animation: "scin .26s ease" }}>
                <Spinner color="#6B6212" track="#D8D7CB" size={15} />
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.bink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{L.agentWorking}</span>
              </div>
            )}
          </div>

          <div className="mc-noscroll" style={{ flex: "0 0 auto", display: "flex", gap: 8, margin: "12px 0", overflowX: "auto" }}>
            {(raw.wsSuggest as string[]).map((sgg) => (
              <button key={sgg} onClick={() => send(sgg)} className="mc-lift" style={{ flex: "0 0 auto", whiteSpace: "nowrap", fontFamily: "var(--mono)", fontSize: 11, border: `1px solid ${C.line}`, borderRadius: 999, padding: "7px 12px", cursor: "pointer", background: "transparent", color: C.mute }}>{sgg}</button>
            ))}
          </div>

          <div style={{ flex: "0 0 auto", display: "flex", gap: 10, alignItems: "center", borderTop: `1px solid ${C.line}`, padding: "14px 0 18px" }}>
            <input
              value={m.chatDraft}
              onChange={(e) => dispatch(modulesActions.setChatDraft(e.target.value))}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder={L.wsComposer}
              style={{ flex: 1, background: C.p3, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", fontSize: 13, color: C.ink }}
            />
            <button onClick={() => send()} style={{ width: 46, height: 46, flex: "0 0 46px", borderRadius: "50%", border: `1px solid ${C.ink}`, background: C.ink, cursor: "pointer", display: "grid", placeItems: "center" }}>
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: C.paper }}><path d="M3 11l18-8-8 18-2-7-8-3z" /></svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "0 22px 18px" }}>
          <div style={{ background: C.ink, borderRadius: 14, padding: 24, minHeight: 266, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
            <span style={{ position: "absolute", top: 14, left: 16, fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "#a9a89d" }}>{L.preview}</span>
            <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "#8e8d83", textAlign: "center", padding: "0 10px" }}>{L.wsPreviewUnavailable}</p>
          </div>
          <p style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: C.mute, lineHeight: 1.6, margin: "12px 2px 0" }}>
            {L.wsPreviewHint} <a href={aiDraftZipUrl(m.workshopMod)} style={{ color: C.bink }}>{L.wsPreviewDownload}</a>
          </p>
        </div>
      )}
    </section>
  );
}
