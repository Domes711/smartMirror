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
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [demoStates, setDemoStates] = useState([]); // [{id,label}] declared by demo.html
  const [activeState, setActiveState] = useState(null);
  const [rev, setRev] = useState(1);

  const streamRef = useRef("");
  const logEnd = useRef(null);
  const frameRef = useRef(null);
  const pendingPrepare = useRef(false);
  const prepareStarted = useRef(false);
  const sseConnected = useRef(false);

  // Run the adopt turn once both the SSE stream is live and `open` decided it is
  // needed — either ordering can win the race, so check from both sides.
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

  // The preview demo.html announces its declared states; collect them for the
  // control panel.
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

  // Switch the live preview to a state (the module reacts in the iframe).
  const applyState = useCallback((id) => {
    setActiveState(id);
    frameRef.current?.contentWindow?.postMessage({ source: "mirror-console", type: "set-state", id }, "*");
  }, []);

  // Opening the controls needs the live preview mounted to drive it.
  const toggleControls = useCallback(() => {
    setShowControls((s) => {
      const next = !s;
      if (next) setShowPreview(true);
      return next;
    });
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

  // Open / load the session (and, for installed modules, ensure demo.html).
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
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, name]);

  function hydrate(msgs, r) {
    const mapped = (msgs || []).map((m) => ({ role: m.role, text: m.text, files: m.files }));
    setMessages(mapped.length ? mapped : greeting ? [{ role: "sys", text: greeting }] : []);
    if (r) setRev(r);
  }

  // Agent output stream.
  useEffect(() => {
    const es = new EventSource(`/api/modules/chat/stream?${qs}`);
    es.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
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
        maybePrepare(); // adopt turn, once the stream is live
      }
    };
    es.onerror = () => {};
    return () => {
      sseConnected.current = false;
      es.close();
    };
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

  return (
    <div className="panel mc-panel">
      <div className="wizard-head">
        {onBack && (
          <button className="mqtt-btn compact" onClick={onBack}>
            ←
          </button>
        )}
        <strong>{title || name}</strong>
        <div className="mc-actions">
          {actions}
        </div>
      </div>

      {banner && <div className="learn-msg">{banner}</div>}

      <section className="card mc-chat">
        <div className="monitor-log mc-log">
          {messages.map((m, i) => (
            <div key={i} className={"mc-msg mc-" + m.role}>
              {m.text}
            </div>
          ))}
          {busy && <div className="mc-msg mc-sys">… pracuji</div>}
          <div ref={logEnd} />
        </div>
        <div className="mc-input">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Napiš, co změnit… (Enter odešle, Shift+Enter nový řádek)"
            disabled={busy}
          />
          <button className="mqtt-btn k-ok" disabled={busy || !draft.trim()} onClick={send}>
            Odeslat
          </button>
        </div>
      </section>

      {/* Floating control bubble — opens the states panel (also shows the view) */}
      <button
        className={"mc-bubble mc-bubble-ctrl" + (showControls ? " mc-bubble-open" : "")}
        onClick={toggleControls}
        title={showControls ? "Skrýt ovládání" : "Ovládání stavů"}
      >
        {showControls ? "✕" : "🎛"}
      </button>

      {/* Floating preview bubble */}
      <button
        className={"mc-bubble" + (showPreview ? " mc-bubble-open" : "")}
        onClick={() => setShowPreview((s) => !s)}
        title={showPreview ? "Skrýt náhled" : "Zobrazit náhled"}
      >
        {showPreview ? "✕" : "👁"}
      </button>

      {/* Live view — reacts to the control panel */}
      {(showPreview || showControls) && (
        <div className="mc-preview-float">
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
        </div>
      )}

      {/* Controls window — switch the module's states; the live view reacts */}
      {showControls && (
        <div className="mc-controls-float">
          <div className="mc-controls-title">Stavy modulu</div>
          {demoStates.length === 0 ? (
            <div className="mc-controls-empty">Tento modul zatím nemá definované stavy.</div>
          ) : (
            <div className="mc-controls-list">
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
