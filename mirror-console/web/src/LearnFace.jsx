import { useCallback, useEffect, useState } from "react";

const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;

// Face-enrollment flow. On mount it switches the supervisor into "learn" mode
// (camera open, framing box); on close the parent restores a normal mode.
export default function LearnFace({ onClose }) {
  const [name, setName] = useState("");
  const [count, setCount] = useState(10);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    fetch("/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "learn" }),
    }).catch(() => {});
  }, []);

  const validName = NAME_RE.test(name);

  const loadPhotos = useCallback(async (n) => {
    if (!NAME_RE.test(n)) {
      setPhotos([]);
      return;
    }
    try {
      const r = await fetch(`/dataset?name=${encodeURIComponent(n)}`);
      const b = await r.json();
      if (r.ok) setPhotos(b.photos || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadPhotos(name);
  }, [name, loadPhotos]);

  const capture = useCallback(async () => {
    if (!validName) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || `capture ${r.status}`);
      await loadPhotos(name);
    } catch (e) {
      setMsg(`Chyba focení: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [name, validName, loadPhotos]);

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

  const train = useCallback(async () => {
    setEncoding(true);
    setMsg(null);
    try {
      const r = await fetch("/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.ok) throw new Error(b.error || "encode selhal");
      setMsg("✅ Natrénováno a uloženo do encoded_faces.pickle.");
    } catch (e) {
      setMsg(`Trénink selhal: ${e.message}`);
    } finally {
      setEncoding(false);
    }
  }, [name]);

  const taken = photos.length;
  const done = taken >= count;

  return (
    <div className="learn">
      <div className="learn-bar">
        <button className="mqtt-btn compact" onClick={onClose}>
          ← Zpět
        </button>
        <strong>Naučit nový obličej</strong>
        <span className={"learn-progress" + (done ? " ok" : "")}>
          {taken}/{count}
        </span>
      </div>

      <div className="learn-grid">
        <div className="card stream-card">
          <img className="stream" src="/stream.mjpg?learn=1" alt="náhled kamery" />
        </div>

        <div className="learn-side">
          <label className="field">
            <span>Jméno osoby</span>
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

          <label className="field">
            <span>Počet fotek</span>
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
            disabled={!validName || busy}
            onClick={capture}
          >
            📷 Pořídit fotku
          </button>
          <button
            className="mqtt-btn"
            disabled={!validName || taken === 0 || encoding}
            onClick={train}
          >
            {encoding ? "Trénuji…" : "Natrénovat a uložit"}
          </button>

          {done && <div className="hint-ok">Máš dost fotek — můžeš natrénovat.</div>}
          {msg && <div className="learn-msg">{msg}</div>}
        </div>
      </div>

      <div className="thumbs">
        {taken === 0 ? (
          <div className="monitor-empty">Zatím žádné fotky…</div>
        ) : (
          photos.map((f) => (
            <div key={f} className="thumb">
              <img
                src={`/photo?name=${encodeURIComponent(name)}&file=${encodeURIComponent(f)}`}
                alt={f}
              />
              <button
                className="thumb-del"
                onClick={() => del(f)}
                disabled={busy}
                title="smazat"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
