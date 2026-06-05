import { useCallback, useEffect, useRef, useState } from "react";
import LoadingOverlay from "./LoadingOverlay.jsx";

// AI module builder. Step 1: name + description (scaffolds a draft). Step 2:
// chat with Claude (runs on the Pi, edits the draft files) while a side button
// reveals a live <iframe> preview of the module's demo.html.
export default function ModuleCreator() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [moduleName, setModuleName] = useState(null); // server-normalised MMM-…
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [existingDrafts, setExistingDrafts] = useState([]);

  const [messages, setMessages] = useState([]); // {role:"user"|"assistant"|"sys", text}
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [rev, setRev] = useState(1);
  const [finalizing, setFinalizing] = useState(false);
  const [finalMsg, setFinalMsg] = useState(null);

  const esRef = useRef(null);
  const streamRef = useRef(""); // accumulates current assistant turn
  const logEnd = useRef(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  // List existing drafts so the user can return to one and keep editing.
  useEffect(() => {
    if (step !== 1) return;
    fetch("/api/modules/list")
      .then((r) => r.json())
      .then((b) => setExistingDrafts(b.drafts || []))
      .catch(() => setExistingDrafts([]));
  }, [step]);

  const openExisting = useCallback(async (n) => {
    setError(null);
    try {
      const r = await fetch(`/api/modules/draft?name=${encodeURIComponent(n)}`);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || "nelze otevřít");
      setModuleName(b.name);
      setDescription(b.description || "");
      setRev(b.rev || 1);
      const msgs = (b.messages || []).map((m) => ({ role: m.role, text: m.text, files: m.files }));
      setMessages([
        { role: "sys", text: `Pokračuješ v úpravách ${b.name}. Historie je zachovaná.` },
        ...msgs,
      ]);
      setStep(2);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Subscribe to the agent's SSE output once we have a module name.
  useEffect(() => {
    if (!moduleName) return;
    const es = new EventSource(`/api/modules/chat/stream?name=${encodeURIComponent(moduleName)}`);
    esRef.current = es;
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
        if (m.touched) setRev(m.rev); // bust the iframe cache -> reload preview
      } else if (m.type === "connected") {
        setRev(m.rev);
      }
    };
    es.onerror = () => {}; // auto-reconnect
    return () => es.close();
  }, [moduleName]);

  const createDraft = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/modules/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.ok) throw new Error(b.error || "nelze vytvořit");
      setModuleName(b.name);
      setRev(b.rev);
      setMessages([
        { role: "sys", text: `Modul ${b.name} připraven. Popiš, co má zobrazovat a jak má vypadat.` },
      ]);
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }, [name, description]);

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
        body: JSON.stringify({ name: moduleName, message: text }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || "chyba");
    } catch (e) {
      setMessages((l) => [...l, { role: "sys", text: `⚠ ${e.message}` }]);
      setBusy(false);
    }
  }, [draft, busy, moduleName]);

  const finalize = useCallback(async () => {
    setFinalizing(true);
    setFinalMsg(null);
    try {
      const r = await fetch("/api/modules/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: moduleName }),
      });
      const b = await r.json().catch(() => ({}));
      if (r.status === 409) {
        if (!confirm(`${moduleName} už na zrcadle existuje. Přepsat?`)) {
          setFinalizing(false);
          return;
        }
        const r2 = await fetch("/api/modules/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: moduleName, overwrite: true }),
        });
        const b2 = await r2.json().catch(() => ({}));
        if (!r2.ok || !b2.ok) throw new Error(b2.error || "instalace selhala");
        setFinalMsg(`Nainstalováno do ${b2.installedTo}. MagicMirror restartován.`);
      } else if (!r.ok || !b.ok) {
        throw new Error(b.error || "instalace selhala");
      } else {
        setFinalMsg(`Nainstalováno do ${b.installedTo}. MagicMirror restartován.`);
      }
    } catch (e) {
      setFinalMsg(`⚠ ${e.message}`);
    } finally {
      setFinalizing(false);
    }
  }, [moduleName]);

  // ---- Step 1: name + description ----------------------------------------
  if (step === 1) {
    return (
      <div className="panel wizard">
        <LoadingOverlay show={creating} message="Připravuji modul…" />
        <div className="wizard-head">
          <strong>Nový modul (AI)</strong>
          <div className="steps">
            <span className="step-dot active">1 Zadání</span>
            <span className="step-dot">2 Vzhled</span>
          </div>
        </div>
        <div className="card wizard-step">
          <label className="field">
            <span>Jméno modulu</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="např. Counter nebo MMM-Counter"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Popis — co má modul dělat / zobrazovat</span>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="např. Odpočet dní do nejbližší výplaty, velké číslo a popisek pod ním."
            />
          </label>
          {error && <div className="hint-bad">{error}</div>}
          <button className="mqtt-btn k-ok" disabled={!name.trim() || creating} onClick={createDraft}>
            Vytvořit a pokračovat →
          </button>
        </div>

        {existingDrafts.length > 0 && (
          <div className="card wizard-step">
            <h3>Pokračovat v rozpracovaném</h3>
            <div className="mc-draftlist">
              {existingDrafts.map((d) => (
                <button key={d.name} className="mqtt-btn mc-draft" onClick={() => openExisting(d.name)}>
                  <strong>{d.name}</strong>
                  {d.description && <span className="mc-draft-desc">{d.description}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- Step 2: chat + live preview ---------------------------------------
  return (
    <div className="panel">
      <div className="wizard-head">
        <strong>{moduleName}</strong>
        <div className="mc-actions">
          <button className="mqtt-btn compact" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? "Skrýt náhled" : "Zobrazit náhled"}
          </button>
          <button className="mqtt-btn k-ok compact" disabled={finalizing} onClick={finalize}>
            Nainstalovat na zrcadlo
          </button>
        </div>
      </div>

      {finalMsg && <div className="learn-msg">{finalMsg}</div>}

      <div className={"mc-split" + (showPreview ? "" : " no-preview")}>
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

        {showPreview && (
          <section className="card mc-preview">
            <div className="mc-preview-head">
              <span>Živý náhled</span>
              <code className="topic">demo.html</code>
            </div>
            <iframe
              key={rev}
              title="náhled modulu"
              src={`/module-draft/${moduleName}/demo.html?v=${rev}`}
              className="mc-frame"
            />
          </section>
        )}
      </div>
    </div>
  );
}
