import { useCallback, useEffect, useState } from "react";
import LoadingOverlay from "./LoadingOverlay.jsx";

const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const AUTO_INTERVAL = 3000; // ms between automatic captures

const setMode = (mode) =>
  fetch("/mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }).catch(() => {});

// Multi-step "add profile" wizard. Step 1: name. Step 2: face learning
// (auto-capture every 3s, enlargeable thumbnails, per-photo replace).
// More steps (module layout, time windows) will be added later.
export default function ProfileWizard({ existing, onClose }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [count, setCount] = useState(10);

  const [photos, setPhotos] = useState([]);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [training, setTraining] = useState(false);
  const [detail, setDetail] = useState(null); // filename being viewed
  const [replacing, setReplacing] = useState(false);
  const [bust, setBust] = useState(0); // cache-buster for replaced photos
  const [error, setError] = useState(null);

  const validName = NAME_RE.test(name);
  const nameExists = existing?.includes(name);

  const loadPhotos = useCallback(async () => {
    try {
      const r = await fetch(`/dataset?name=${encodeURIComponent(name)}`);
      const b = await r.json();
      if (r.ok) setPhotos(b.photos || []);
    } catch {
      /* ignore */
    }
  }, [name]);

  const capture = useCallback(
    async (file) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch("/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(file ? { name, file } : { name }),
        });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error || `capture ${r.status}`);
        await loadPhotos();
        if (file) setBust((v) => v + 1);
      } catch (e) {
        setError(`Focení selhalo: ${e.message}`);
      } finally {
        setBusy(false);
      }
    },
    [name, loadPhotos]
  );

  // automatic capture every 3s while on step 2 (paused in detail view)
  useEffect(() => {
    if (step !== 2 || !auto || detail) return;
    if (photos.length >= count) {
      setAuto(false);
      return;
    }
    const id = setTimeout(() => capture(), AUTO_INTERVAL);
    return () => clearTimeout(id);
  }, [step, auto, detail, photos.length, count, capture]);

  const goStep2 = () => {
    setMode("learn");
    setStep(2);
    setAuto(true);
  };

  const finish = useCallback(async () => {
    setTraining(true);
    setError(null);
    try {
      const r = await fetch("/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.ok) throw new Error(b.error || "trénink selhal");
      await setMode("face_detect");
      onClose(true);
    } catch (e) {
      setError(`Trénink selhal: ${e.message}`);
      setTraining(false);
    }
  }, [name, onClose]);

  const cancel = useCallback(() => {
    if (step === 2) setMode("face_detect");
    onClose(false);
  }, [step, onClose]);

  const photoUrl = (f) =>
    `/photo?name=${encodeURIComponent(name)}&file=${encodeURIComponent(f)}&v=${bust}`;

  return (
    <div className="panel wizard">
      <LoadingOverlay show={training} message="Trénuji obličej a ukládám…" />

      <div className="wizard-head">
        <button className="mqtt-btn compact" onClick={cancel}>
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
            <span>Počet fotek (auto-focení po 3 s)</span>
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
          <button className="mqtt-btn k-ok" disabled={!validName} onClick={goStep2}>
            Pokračovat →
          </button>
        </div>
      )}

      {step === 2 && (
        <>
          <div className="learn-grid">
            <div className="card stream-card">
              <img className="stream" src="/stream.mjpg?learn=1" alt="náhled kamery" />
            </div>
            <div className="learn-side">
              <div className="learn-progress-row">
                <span className={"learn-progress" + (photos.length >= count ? " ok" : "")}>
                  {photos.length}/{count} fotek
                </span>
                {auto ? (
                  <button className="mqtt-btn compact" onClick={() => setAuto(false)}>
                    ⏸ Pozastavit
                  </button>
                ) : (
                  <button
                    className="mqtt-btn compact"
                    disabled={photos.length >= count}
                    onClick={() => setAuto(true)}
                  >
                    ▶ Pokračovat
                  </button>
                )}
              </div>
              <button className="mqtt-btn" disabled={busy} onClick={() => capture()}>
                📷 Pořídit teď
              </button>
              <button
                className="mqtt-btn k-ok"
                disabled={photos.length === 0 || training}
                onClick={finish}
              >
                Dokončit a natrénovat
              </button>
              {error && <div className="learn-msg">{error}</div>}
            </div>
          </div>

          <div className="thumbs">
            {photos.length === 0 ? (
              <div className="monitor-empty">Zatím žádné fotky… (auto za 3 s)</div>
            ) : (
              photos.map((f) => (
                <button key={f} className="thumb" onClick={() => setDetail(f)}>
                  <img src={photoUrl(f)} alt={f} />
                </button>
              ))
            )}
          </div>
        </>
      )}

      {detail && (
        <div className="overlay" onClick={() => !replacing && setDetail(null)}>
          <div className="detail-box" onClick={(e) => e.stopPropagation()}>
            {replacing ? (
              <>
                <div className="card stream-card detail-stream">
                  <img className="stream" src="/stream.mjpg?replace=1" alt="náhled" />
                </div>
                <div className="detail-actions">
                  <button className="mqtt-btn compact" onClick={() => setReplacing(false)}>
                    Zrušit
                  </button>
                  <button
                    className="mqtt-btn k-ok"
                    disabled={busy}
                    onClick={async () => {
                      await capture(detail);
                      setReplacing(false);
                    }}
                  >
                    📷 Pořídit nový snímek
                  </button>
                </div>
              </>
            ) : (
              <>
                <img className="detail-img" src={photoUrl(detail)} alt={detail} />
                <div className="detail-actions">
                  <button className="mqtt-btn compact" onClick={() => setDetail(null)}>
                    Zavřít
                  </button>
                  <button className="mqtt-btn k-warn" onClick={() => setReplacing(true)}>
                    Nahradit snímek
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
