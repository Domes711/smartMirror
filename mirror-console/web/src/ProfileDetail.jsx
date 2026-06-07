import { useCallback, useEffect, useState } from "react";
import LoadingOverlay from "./LoadingOverlay.jsx";
import FaceCaptureSession from "./FaceCaptureSession.jsx";
import LayoutTab from "./LayoutTab.jsx";
import { useToast } from "./Toast.jsx";

// Detail of one profile. Card-style tabs (more to come); for now just "Fotky":
// all training thumbnails (enlarge + delete), add more photos (modal → capture
// session → retrain), retrain, and remove the whole profile.
export default function ProfileDetail({ name, onBack }) {
  const [tab, setTab] = useState("layout");
  const [windowOpen, setWindowOpen] = useState(false); // a time-window layout editor is open
  const [photos, setPhotos] = useState([]);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(null); // overlay message while encoding/removing
  const toast = useToast();

  const [askCount, setAskCount] = useState(false);
  const [addCount, setAddCount] = useState(5);
  const [capturing, setCapturing] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  const loadPhotos = useCallback(async () => {
    try {
      const r = await fetch(`/dataset?name=${encodeURIComponent(name)}`);
      const b = await r.json();
      if (r.ok) setPhotos(b.photos || []);
    } catch {
      /* ignore */
    }
  }, [name]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const del = useCallback(
    async (file) => {
      setBusy(true);
      try {
        const r = await fetch(
          `/dataset?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`,
          { method: "DELETE" }
        );
        const b = await r.json().catch(() => ({}));
        if (r.ok) setPhotos(b.photos || []);
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
    },
    [name]
  );

  const retrain = useCallback(async () => {
    setWorking("Přetrénovávám…");
    try {
      const r = await fetch("/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.ok) throw new Error(b.error || "trénink selhal");
      toast.success("Profil přetrénován ✓");
    } catch (e) {
      toast.error(`Trénink selhal: ${e.message}`);
    } finally {
      setWorking(null);
    }
  }, [name, toast]);

  const finishAdding = useCallback(async () => {
    setCapturing(false); // unmounts the session -> camera released
    await retrain();
    await loadPhotos();
  }, [retrain, loadPhotos]);

  const removeProfile = useCallback(async () => {
    if (!window.confirm(`Odebrat profil „${name}"? Smažou se všechny fotky.`)) return;
    setWorking("Odebírám profil a přetrénovávám…");
    try {
      const r = await fetch(`/profiles?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || `remove ${r.status}`);
      }
      toast.success(`Profil „${name}" odebrán.`);
      onBack();
    } catch (e) {
      toast.error(`Odebrání selhalo: ${e.message}`);
      setWorking(null);
    }
  }, [name, onBack, toast]);

  const photoUrl = (f) =>
    `/photo?name=${encodeURIComponent(name)}&file=${encodeURIComponent(f)}`;

  return (
    <div className="panel">
      <LoadingOverlay show={!!working} message={working} />

      <div className="wizard-head profile-head">
        <button className="pill pill-btn" onClick={onBack}>
          ← Profily
        </button>
        <strong>{name}</strong>
      </div>

      {!windowOpen && (
        <div className="subnav">
          <button className={"subnav-item" + (tab === "layout" ? " active" : "")} onClick={() => setTab("layout")}>
            Rozložení
          </button>
          <button className={"subnav-item" + (tab === "photos" ? " active" : "")} onClick={() => setTab("photos")}>
            Fotky
          </button>
          <button className={"subnav-item" + (tab === "settings" ? " active" : "")} onClick={() => setTab("settings")}>
            Nastavení
          </button>
        </div>
      )}

      <div className="detail-scroll">
        {tab === "layout" && <LayoutTab profile={name} onWindowChange={setWindowOpen} />}

        {tab === "settings" && (
          <div className="card wizard-step">
            <button className="mqtt-btn k-bad" onClick={removeProfile}>
              Odebrat profil
            </button>
          </div>
        )}

        {tab === "photos" && !capturing && (
          <>
            <div className="thumbs">
              {photos.length === 0 ? (
                <div className="monitor-empty">Žádné fotky.</div>
              ) : (
                photos.map((f) => (
                  <button key={f} className="thumb" onClick={() => setDetail(f)}>
                    <img src={photoUrl(f)} alt={f} />
                  </button>
                ))
              )}
            </div>

            <div className="panel-actions detail-foot">
              <button className="mqtt-btn k-ok" onClick={() => setAskCount(true)}>
                ＋ Přidat další fotky
              </button>
              <button className="mqtt-btn" disabled={photos.length === 0} onClick={retrain}>
                Přetrénovat
              </button>
            </div>
          </>
        )}

        {tab === "photos" && capturing && (
          <>
            <FaceCaptureSession
              name={name}
              target={photos.length + addCount}
              onPhotosChange={(p) => setSessionCount(p.length)}
            />
            <div className="panel-actions detail-foot">
              <button className="mqtt-btn compact" onClick={() => { setCapturing(false); loadPhotos(); }}>
                Zrušit (bez tréninku)
              </button>
              <button className="mqtt-btn k-ok" disabled={sessionCount === 0} onClick={finishAdding}>
                Přidat a přetrénovat
              </button>
            </div>
          </>
        )}
      </div>

      {/* static photo detail (view mode) */}
      {detail && !capturing && (
        <div className="overlay" onClick={() => setDetail(null)}>
          <div className="detail-box" onClick={(e) => e.stopPropagation()}>
            <img className="detail-img" src={photoUrl(detail)} alt={detail} />
            <div className="detail-actions">
              <button className="mqtt-btn compact" onClick={() => setDetail(null)}>
                Zavřít
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
          </div>
        </div>
      )}

      {/* "how many new photos" modal */}
      {askCount && (
        <div className="overlay" onClick={() => setAskCount(false)}>
          <div className="detail-box ask-box" onClick={(e) => e.stopPropagation()}>
            <label className="field">
              <span>Kolik nových fotek?</span>
              <input
                type="number"
                min="1"
                max="100"
                value={addCount}
                onChange={(e) => setAddCount(Math.max(1, parseInt(e.target.value || "1", 10)))}
                autoFocus
              />
            </label>
            <div className="detail-actions">
              <button className="mqtt-btn compact" onClick={() => setAskCount(false)}>
                Zrušit
              </button>
              <button
                className="mqtt-btn k-ok"
                onClick={() => {
                  setAskCount(false);
                  setCapturing(true);
                }}
              >
                Start
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
