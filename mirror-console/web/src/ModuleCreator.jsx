import { useCallback, useEffect, useState } from "react";
import LoadingOverlay from "./LoadingOverlay.jsx";
import ModuleEditor from "./ModuleEditor.jsx";

// AI module builder. Step 1: name + description (scaffolds a draft) or reopen an
// existing draft. Step 2: the shared chat + live-preview editor, plus a button
// to install the finished module onto the mirror.
export default function ModuleCreator({ onBack } = {}) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState("new"); // step-1 subsection: "new" | "continue"
  const [name, setName] = useState("");
  const [moduleName, setModuleName] = useState(null); // server-normalised MMM-…
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [existingDrafts, setExistingDrafts] = useState([]);

  const [finalizing, setFinalizing] = useState(false);
  const [finalMsg, setFinalMsg] = useState(null);

  useEffect(() => {
    if (step !== 1) return;
    fetch("/api/modules/list")
      .then((r) => r.json())
      .then((b) => setExistingDrafts(b.drafts || []))
      .catch(() => setExistingDrafts([]));
  }, [step]);

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
      setFinalMsg(null);
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }, [name, description]);

  const openExisting = useCallback((n) => {
    setModuleName(n);
    setFinalMsg(null);
    setStep(2);
  }, []);

  const finalize = useCallback(async () => {
    setFinalizing(true);
    setFinalMsg(null);
    const post = (overwrite) =>
      fetch("/api/modules/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: moduleName, overwrite }),
      });
    try {
      let r = await post(false);
      if (r.status === 409) {
        if (!confirm(`${moduleName} už na zrcadle existuje. Přepsat?`)) {
          setFinalizing(false);
          return;
        }
        r = await post(true);
      }
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.ok) throw new Error(b.error || "instalace selhala");
      setFinalMsg(`Nainstalováno do ${b.installedTo}. MagicMirror restartován.`);
    } catch (e) {
      setFinalMsg(`⚠ ${e.message}`);
    } finally {
      setFinalizing(false);
    }
  }, [moduleName]);

  // ---- Step 1: name + description / reopen -------------------------------
  if (step === 1) {
    return (
      <div className="panel wizard">
        <LoadingOverlay show={creating} message="Připravuji modul…" />
        <div className="wizard-head">
          {onBack && (
            <button className="mqtt-btn compact" onClick={onBack}>←</button>
          )}
          <strong>Nový modul (AI)</strong>
          <div className="steps">
            <span className="step-dot active">1 Zadání</span>
            <span className="step-dot">2 Vzhled</span>
          </div>
        </div>

        <div className="tabs creator-subtabs">
          <button
            className={"tab" + (mode === "new" ? " active" : "")}
            onClick={() => setMode("new")}
          >
            Vytvořit nový
          </button>
          <button
            className={"tab" + (mode === "continue" ? " active" : "")}
            onClick={() => setMode("continue")}
          >
            Pokračovat na rozpracovaném
            {existingDrafts.length > 0 && ` (${existingDrafts.length})`}
          </button>
        </div>

        {mode === "new" && (
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
        )}

        {mode === "continue" && (
          <div className="card wizard-step">
            {existingDrafts.length > 0 ? (
              <div className="mc-draftlist">
                {existingDrafts.map((d) => (
                  <button key={d.name} className="mqtt-btn mc-draft" onClick={() => openExisting(d.name)}>
                    <strong>{d.name}</strong>
                    {d.description && <span className="mc-draft-desc">{d.description}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="store-note">Žádné rozpracované moduly.</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- Step 2: shared chat + preview editor ------------------------------
  return (
    <ModuleEditor
      scope="draft"
      name={moduleName}
      title={moduleName}
      greeting={`Modul ${moduleName} připraven. Popiš, co má zobrazovat a jak má vypadat.`}
      banner={finalMsg}
      onBack={() => setStep(1)}
      actions={
        <button className="mqtt-btn k-ok compact" disabled={finalizing} onClick={finalize}>
          Nainstalovat na zrcadlo
        </button>
      }
    />
  );
}
