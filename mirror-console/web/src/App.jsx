import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

// Modes mirror supervisor.py MODES. Order = display order in the switcher.
const MODES = [
  { id: "face_detect", label: "Face detect", hint: "Produkce — kameru drží daemon" },
  { id: "test_face", label: "Test obličejů", hint: "Stream + detekce obličejů" },
  { id: "test_gesture", label: "Test gest", hint: "Stream + detekce gest" },
];

const isTestMode = (m) => m === "test_face" || m === "test_gesture";

export default function App() {
  const [health, setHealth] = useState(null);
  const [pending, setPending] = useState(null); // mode id being switched to
  const [error, setError] = useState(null);
  // cache-buster so the <img> reconnects to a fresh stream after a mode switch
  const [streamKey, setStreamKey] = useState(0);
  const pollRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/healthz");
      if (!res.ok) throw new Error(`healthz ${res.status}`);
      setHealth(await res.json());
      setError(null);
    } catch (e) {
      setError("Backend nedostupný");
    }
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 2000);
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  const switchMode = useCallback(
    async (mode) => {
      if (pending || health?.mode === mode) return;
      setPending(mode);
      setError(null);
      try {
        const res = await fetch("/mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `mode ${res.status}`);
        }
        setHealth(await res.json());
        setStreamKey((k) => k + 1);
      } catch (e) {
        setError(`Přepnutí selhalo: ${e.message}`);
        refresh();
      } finally {
        setPending(null);
      }
    },
    [pending, health, refresh]
  );

  const mode = health?.mode;
  const testing = isTestMode(mode);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Mirror Console</h1>
        <StatusPill health={health} error={error} />
      </header>

      <section className="switcher" role="tablist" aria-label="Režim kamery">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={
              "seg" +
              (mode === m.id ? " active" : "") +
              (pending === m.id ? " pending" : "")
            }
            disabled={!!pending}
            onClick={() => switchMode(m.id)}
          >
            <span className="seg-label">{m.label}</span>
            <span className="seg-hint">{m.hint}</span>
          </button>
        ))}
      </section>

      <main className="stage">
        {testing ? (
          <div className="card stream-card">
            <img
              key={streamKey}
              className="stream"
              src={`/stream.mjpg?k=${streamKey}`}
              alt="Živý obraz z kamery"
            />
          </div>
        ) : (
          <div className="card status-card">
            <div className="status-icon">🪞</div>
            <h2>Produkční rozpoznávání obličejů</h2>
            <p>
              Kameru drží daemon <code>face_reco</code>. Pro živý náhled přepni
              na <strong>Test obličejů</strong> nebo <strong>Test gest</strong>.
            </p>
            <p className="daemon-line">
              Daemon:{" "}
              <span className={health?.daemon_active ? "ok" : "bad"}>
                {health?.daemon_active ? "běží" : "neběží"}
              </span>
            </p>
          </div>
        )}
      </main>

      <footer className="footer">
        smart mirror · {health ? `${health.width}×${health.height}` : "…"} ·
        konzole kamery
      </footer>
    </div>
  );
}

function StatusPill({ health, error }) {
  if (error) return <span className="pill pill-bad">● {error}</span>;
  if (!health) return <span className="pill">● spojuji…</span>;
  if (isTestMode(health.mode)) {
    const live = health.camera_open;
    return (
      <span className={"pill " + (live ? "pill-live" : "pill-warn")}>
        ● {live ? `live · ${health.fps} fps` : "kamera se spouští…"}
      </span>
    );
  }
  return (
    <span className={"pill " + (health.daemon_active ? "pill-live" : "pill-warn")}>
      ● {health.daemon_active ? "daemon běží" : "daemon stojí"}
    </span>
  );
}
