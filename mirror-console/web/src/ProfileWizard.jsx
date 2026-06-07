import { useCallback, useState } from "react";
import LoadingOverlay from "./LoadingOverlay.jsx";
import FaceCaptureSession from "./FaceCaptureSession.jsx";
import { useToast } from "./Toast.jsx";

const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;

// Multi-step "add profile" wizard. Step 1: name + base photo count.
// Step 2: face learning (FaceCaptureSession — auto-capture, extendable,
// per-photo replace/delete). More steps (layout, time windows) come later.
export default function ProfileWizard({ existing, onClose }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [count, setCount] = useState(10);
  const [photoCount, setPhotoCount] = useState(0);
  const [training, setTraining] = useState(false);
  const toast = useToast();

  const validName = NAME_RE.test(name);
  const nameExists = existing?.includes(name);

  const finish = useCallback(async () => {
    setTraining(true);
    try {
      const r = await fetch("/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.ok) throw new Error(b.error || "trénink selhal");
      toast.success(`Profil „${name}" vytvořen.`);
      onClose(true);
    } catch (e) {
      toast.error(`Trénink selhal: ${e.message}`);
      setTraining(false);
    }
  }, [name, onClose, toast]);

  return (
    <div className="panel wizard">
      <LoadingOverlay show={training} message="Trénuji obličej a ukládám…" />

      <div className="wizard-head">
        <button className="mqtt-btn compact" onClick={() => onClose(false)}>
          ← Zrušit
        </button>
        <strong>Nový profil</strong>
        <div className="steps">
          <span className={"step-dot" + (step >= 1 ? " active" : "")}>1 Jméno</span>
          <span className={"step-dot" + (step >= 2 ? " active" : "")}>2 Obličej</span>
        </div>
      </div>

      {step === 1 && (
        <div className="card wizard-step">
          <label className="field">
            <span>Jméno profilu</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.trim())}
              placeholder="např. Domes"
              autoFocus
            />
          </label>
          {name && !validName && (
            <div className="hint-bad">Povolené znaky: písmena, číslice, _ -</div>
          )}
          {nameExists && (
            <div className="hint-ok">Profil existuje — fotky se přidají k němu.</div>
          )}
          <label className="field">
            <span>Počet fotek (auto-focení po 3 s, jde rozšířit)</span>
            <input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, parseInt(e.target.value || "1", 10)))
              }
            />
          </label>
          <button
            className="mqtt-btn k-ok"
            disabled={!validName}
            onClick={() => setStep(2)}
          >
            Pokračovat →
          </button>
        </div>
      )}

      {step === 2 && (
        <>
          <FaceCaptureSession
            name={name}
            target={count}
            onPhotosChange={(p) => setPhotoCount(p.length)}
          />
          <div className="panel-actions">
            <button
              className="mqtt-btn k-ok"
              disabled={photoCount === 0 || training}
              onClick={finish}
            >
              Dokončit a natrénovat ({photoCount})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
