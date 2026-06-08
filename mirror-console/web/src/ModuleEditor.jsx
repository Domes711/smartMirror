import { useCallback, useEffect, useRef, useState } from "react";

// Reusable chat + live-preview editor for one module, shared by the new-module
// wizard (scope="draft") and the Module Store edit flow (scope="installed").
//
// Props:
//   scope        "draft" | "installed"
//   name         MMM-… module name
//   title        header label
//   actions      extra header buttons (finalize / restart)
//   banner       optional message rendered under the header
//   greeting     sys line shown when there is no history yet
//   autoPrepare  installed-only: run the one-time adopt turn on first open
//   onBack       optional back button handler
export default function ModuleEditor({
  scope,
  name,
  title,
  actions,
  banner,
  greeting,
  autoPrepare = false,
  onBack,
}) {
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoStates, setDemoStates] = useState([]);
  const [activeState, setActiveState] = useState(null);
  const [rev, setRev] = useState(1);

  const streamRef = useRef("");
  const logEnd = useRef(null);
  const frameRef = useRef(null);
  const pendingPrepare = useRef(false);
  const prepareStarted = useRef(false);
  const sseConnected = useRef(false);

  const maybePrepare = useCallback(() => {
    if (sseConnected.current && pendingPrepare.current) {
      pendingPrepare.current = false;
      triggerPrepareRef.current?.();
    }
  }, []);
  const triggerPrepareRef = useRef(null);

  const previewBase = scope === "installed" ? `/module-installed/${name}` : `/module-draft/${name}`;
  const qs = `name=${encodeURIComponent(name)}&scope=${scope}`;

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  useEffect(() => {
    const onMsg = (ev) => {
      const d = ev.data || {};
      if (d.source === "mirror-demo" && d.type === "states" && Array.isArray(d.states)) {
        setDemoStates(d.states);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const applyState = useCallback((id) => {
    setActiveState(id);
    frameRef.current?.contentWindow?.postMessage({ source: "mirror-console", type: "set-state", id }, "*");
  }, []);

  const triggerPrepare = useCallback(async () => {
    if (prepareStarted.current) return;
    prepareStarted.current = true;
    setBusy(true);
    streamRef.current = "";
    try {
      const r = await fetch("/api/modules/edit/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || "příprava selhala");
      if (b.alreadyPrepared) setBusy(false);
    } catch (e) {
      setMessages((l) => [...l, { role: "sys", text: `⚠ ${e.message}` }]);
      setBusy(false);
    }
  }, [name]);
  triggerPrepareRef.current = triggerPrepare;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (scope === "installed") {
          const r = await fetch("/api/modules/edit/open", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const b = await r.json().catch(() => ({}));
          if (!alive) return;
          if (!r.ok) throw new Error(b.error || "nelze otevřít");
          hydrate(b.messages, b.rev);
          if (autoPrepare && !b.prepared) {
            pendingPrepare.current = true;
            maybePrepare();
          }
        } else {
          const r = await fetch(`/api/modules/session?${qs}`);
          const b = await r.json().catch(() => ({}));
          if (!alive) return;
          hydrate(r.ok ? b.messages : [], r.ok ? b.rev : 1);
        }
      } catch (e) {
        if (alive) setMessages([{ role: "sys", text: `⚠ ${e.message}` }]);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, name]);

  function hydrate(msgs, r) {
    const mapped = (msgs || []).map((m) => ({ role: m.role, text: m.text, files: m.files }));
    setMessages(mapped.length ? mapped : greeting ? [{ role: "sys", text: greeting }] : []);
    if (r) setRev(r);
  }

  useEffect(() => {
    const es = new EventSource(`/api/modules/chat/stream?${qs}`);
    es.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "text") {
        streamRef.current += m.text;
        setMessages((l) => {
          const next = [...l];
          if (next.length && next[next.length - 1].role === "assistant" && next[next.length - 1].live) {
            next[next.length - 1] = { role: "assistant", text: streamRef.current, live: true };
          } else {
            next.push({ role: "assistant", text: streamRef.current, live: true });
          }
          return next;
        });
      } else if (m.type === "tool") {
        setMessages((l) => [...l, { role: "sys", text: `✎ ${m.tool}${m.file ? " · " + m.file : ""}` }]);
      } else if (m.type === "error") {
        setMessages((l) => [...l, { role: "sys", text: `⚠ ${m.text}` }]);
      } else if (m.type === "done") {
        streamRef.current = "";
        setBusy(false);
        setMessages((l) => l.map((x) => (x.live ? { ...x, live: false } : x)));
        if (m.touched) setRev(m.rev);
      } else if (m.type === "connected") {
        setRev(m.rev);
        sseConnected.current = true;
        maybePrepare();
      }
    };
    es.onerror = () => {};
    return () => { sseConnected.current = false; es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, name]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setMessages((l) => [...l, { role: "user", text }]);
    streamRef.current = "";
    try {
      const r = await fetch("/api/modules/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scope, message: text }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || "chyba");
    } catch (e) {
      setMessages((l) => [...l, { role: "sys", text: `⚠ ${e.message}` }]);
      setBusy(false);
    }
  }, [draft, busy, name, scope]);

  const started = busy || messages.some((m) => m.role === "user" || m.role === "assistant");
  const sysClass = (text) =>
    "mc-msg mc-sys" +
    (text?.startsWith("⚠") ? " mc-sys-error" : text?.startsWith("✎") ? " mc-sys-tool" : "");

  return (
    <div className="panel creator-panel">
      <header className="mc-head">
        {onBack && (
          <button className="mqtt-btn compact k-muted" onClick={onBack} title="Zpět">←</button>
        )}
        <strong className="mc-head-name">{title || name}</strong>
        <div className="mc-actions">{actions}</div>
      </header>

      {banner && <div className="learn-msg">{banner}</div>}

      <div className="subnav">
        <button className={"subnav-item" + (tab === "chat" ? " active" : "")} onClick={() => setTab("chat")}>
          Chat
        </button>
        <button className={"subnav-item" + (tab === "preview" ? " active" : "")} onClick={() => setTab("preview")}>
          Náhled
        </button>
      </div>

      {/* Chat — always mounted so SSE stream is uninterrupted */}
      <div className={"mc-chat" + (tab !== "chat" ? " mc-hidden" : "")}>
        <div className="mc-log">
          {started ? (
            <>
              {messages.map((m, i) =>
                m.role === "sys" ? (
                  <div key={i} className={sysClass(m.text)}>{m.text}</div>
                ) : (
                  <div key={i} className={"mc-msg mc-" + m.role}>
                    {m.role === "assistant" && <span className="mc-msg-role">Claude</span>}
                    {m.text}
                  </div>
                )
              )}
              {busy && (
                <div className="mc-typing" aria-label="pracuji">
                  <span /><span /><span />
                </div>
              )}
            </>
          ) : (
            <div className="mc-hero">
              <div className="mc-hero-icon">🧩</div>
              <p className="mc-hero-text">{greeting || `Modul ${name} připraven.`}</p>
              <p className="mc-hero-hint">Napiš dole, co má modul zobrazovat a jak má vypadat.</p>
            </div>
          )}
          <div ref={logEnd} />
        </div>
        <div className="mc-input">
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Napiš, co změnit… (Enter odešle, Shift+Enter nový řádek)"
            disabled={busy}
          />
          <button className="mc-send" disabled={busy || !draft.trim()} onClick={send} title="Odeslat">➤</button>
        </div>
      </div>

      {/* Preview + controls */}
      {tab === "preview" && (
        <div className="mc-preview-panel">
          <iframe
            ref={frameRef}
            key={rev}
            title="náhled modulu"
            src={`${previewBase}/demo.html?v=${rev}`}
            className="mc-frame"
            onLoad={() => {
              frameRef.current?.contentWindow?.postMessage({ source: "mirror-console", type: "get-states" }, "*");
              if (activeState) applyState(activeState);
            }}
          />
          {demoStates.length > 0 && (
            <div className="mc-controls-inline">
              <span className="mc-controls-label">Stavy</span>
              {demoStates.map((s) => (
                <button
                  key={s.id}
                  className={"mqtt-btn compact" + (activeState === s.id ? " k-ok" : "")}
                  onClick={() => applyState(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
