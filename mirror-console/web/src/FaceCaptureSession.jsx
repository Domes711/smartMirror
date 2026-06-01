import { useCallback, useEffect, useState } from "react";

const AUTO_INTERVAL = 3000; // ms between automatic captures

const setMode = (mode) =>
  fetch("/mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }).catch(() => {});

// Reusable face-capture session: holds the camera in "learn" mode, auto-captures
// every 3s up to a target (which can be extended), and shows thumbnails with a
// detail view (enlarge / replace / delete). Used by the add-profile wizard and
// the profile detail "add photos" flow. The parent owns the train/finish action.
export default function FaceCaptureSession({ name, target, onPhotosChange }) {
  const [photos, setPhotos] = useState([]);
  const [tgt, setTgt] = useState(target);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [replacing, setReplacing] = useState(false);
  const [bust, setBust] = useState(0);
  const [more, setMore] = useState(5);
  const [error, setError] = useState(null);

  // hold the camera in learn mode for the lifetime of the session
  useEffect(() => {
    setMode("learn");
    return () => setMode("face_detect");
  }, []);

  const loadPhotos = useCallback(async () => {
    try {
      const r = await fetch(`/dataset?name=${encodeURIComponent(name)}`);
      const b = await r.json();
      if (r.ok) {
        setPhotos(b.photos || []);
        onPhotosChange?.(b.photos || []);
      }
    } catch {
      /* ignore */
    }
  }, [name, onPhotosChange]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

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

  const del = useCallback(
    async (file) => {
      setBusy(true);
      try {
        const r = await fetch(
          `/dataset?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`,
          { method: "DELETE" }
        );
        const b = await r.json().catch(() => ({}));
        if (r.ok) {
          setPhotos(b.photos || []);
          onPhotosChange?.(b.photos || []);
        }
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
    },
    [name, onPhotosChange]
  );

  // automatic capture every 3s (paused while the detail view is open)
  useEffect(() => {
    if (!auto || detail) return;
    if (photos.length >= tgt) {
      setAuto(false);
      return;
    }
    const id = setTimeout(() => capture(), AUTO_INTERVAL);
    return () => clearTimeout(id);
  }, [auto, detail, photos.length, tgt, capture]);

  const photoUrl = (f) =>
    `/photo?name=${encodeURIComponent(name)}&file=${encodeURIComponent(f)}&v=${bust}`;

  const extend = () => {
    setTgt((t) => Math.max(t, photos.length) + more);
    setAuto(true);
  };

  return (
    <>
      <div className="learn-grid">
        <div className="card stream-card">
          <img className="stream" src="/stream.mjpg?learn=1" alt="náhled kamery" />
        </div>
        <div className="learn-side">
          <div className="learn-progress-row">
            <span className={"learn-progress" + (photos.length >= tgt ? " ok" : "")}>
              {photos.length}/{tgt} fotek
            </span>
            {auto ? (
              <button className="mqtt-btn compact" onClick={() => setAuto(false)}>
                ⏸ Pozastavit
              </button>
            ) : (
              <button
                className="mqtt-btn compact"
                disabled={photos.length >= tgt}
                onClick={() => setAuto(true)}
              >
                ▶ Pokračovat
              </button>
            )}
          </div>
          <button className="mqtt-btn" disabled={busy} onClick={() => capture()}>
            📷 Pořídit teď
          </button>
          <div className="add-more">
            <input
              type="number"
              min="1"
              max="100"
              value={more}
              onChange={(e) => setMore(Math.max(1, parseInt(e.target.value || "1", 10)))}
            />
            <button className="mqtt-btn compact" onClick={extend}>
              ＋ Přidat další
            </button>
          </div>
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
                    Nahradit
                  </button>
                  <button
                    className="mqtt-btn k-bad"
                    disabled={busy}
                    onClick={async () => {
                      await del(detail);
                      setDetail(null);
                    }}
                  >
                    Smazat
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
