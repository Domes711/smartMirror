import { useEffect, useState } from "react";
import "./App.css";

const MQTT_BASE = "/api/mqtt";

const COLOR_PRESETS = [
  { value: "5000K", label: "5000K (teplá)" },
  { value: "6500K", label: "6500K (neutrální)" },
  { value: "7500K", label: "7500K" },
  { value: "9300K", label: "9300K" },
  { value: "10000K", label: "10000K (studená)" },
  { value: "user1", label: "User 1" },
  { value: "user2", label: "User 2" }
];

const DISPLAY_MODES = [
  { value: "standard", label: "Standard" },
  { value: "movie", label: "Movie" },
  { value: "games", label: "Games" }
];

export default function MonitorPanel() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load current state
  const loadState = async () => {
    try {
      const res = await fetch(`${MQTT_BASE}/subscribe?topic=smartmirror/monitor/state&count=1&timeout=2000`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        const msg = JSON.parse(data.messages[0].payload);
        setState(msg);
      }
    } catch (err) {
      console.error("Failed to load monitor state:", err);
    }
  };

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, 5000);
    return () => clearInterval(interval);
  }, []);

  const publish = async (topic, value) => {
    setLoading(true);
    try {
      const payload = typeof value === "object" ? JSON.stringify(value) : String(value);
      await fetch(`${MQTT_BASE}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `smartmirror/monitor/control/${topic}`,
          payload
        })
      });
      // Wait a bit for monitor to update
      setTimeout(loadState, 1000);
    } catch (err) {
      console.error("Publish failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <h2>Monitor Control</h2>
      <p>Ovládání Dell U2515H přes DDC/CI (ddcutil)</p>

      {state && (
        <div className="monitor-state">
          <h3>Aktuální stav</h3>
          <div className="state-grid">
            <div>
              <strong>Jas:</strong> {state.brightness ?? "—"}%
            </div>
            <div>
              <strong>Kontrast:</strong> {state.contrast ?? "—"}%
            </div>
            <div>
              <strong>RGB:</strong> R{state.red ?? "—"} G{state.green ?? "—"} B{state.blue ?? "—"}
            </div>
          </div>
        </div>
      )}

      <div className="monitor-controls">
        {/* Brightness */}
        <div className="control-group">
          <label>
            Jas (Brightness)
            <input
              type="range"
              min="0"
              max="100"
              value={state?.brightness ?? 100}
              onChange={(e) => publish("brightness", e.target.value)}
              disabled={loading}
            />
            <span className="value">{state?.brightness ?? 100}%</span>
          </label>
        </div>

        {/* Contrast */}
        <div className="control-group">
          <label>
            Kontrast (Contrast)
            <input
              type="range"
              min="0"
              max="100"
              value={state?.contrast ?? 100}
              onChange={(e) => publish("contrast", e.target.value)}
              disabled={loading}
            />
            <span className="value">{state?.contrast ?? 100}%</span>
          </label>
        </div>

        {/* E2 Custom Feature */}
        <div className="control-group">
          <label>
            E2 Enhancement (0-25)
            <input
              type="range"
              min="0"
              max="25"
              defaultValue="25"
              onChange={(e) => publish("e2", e.target.value)}
              disabled={loading}
            />
          </label>
        </div>

        {/* Power */}
        <div className="control-group">
          <label>Napájení</label>
          <div className="button-row">
            <button onClick={() => publish("power", "on")} disabled={loading}>
              ✓ Zapnout
            </button>
            <button onClick={() => publish("power", "off")} disabled={loading}>
              ✕ Vypnout
            </button>
          </div>
        </div>

        {/* Display Mode */}
        <div className="control-group">
          <label>
            Režim zobrazení
            <select onChange={(e) => publish("mode", e.target.value)} disabled={loading}>
              {DISPLAY_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Color Preset */}
        <div className="control-group">
          <label>
            Teplota barev
            <select onChange={(e) => publish("preset", e.target.value)} disabled={loading}>
              {COLOR_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* RGB Gains */}
        <div className="control-group">
          <h4>RGB Gain</h4>
          <label>
            Red
            <input
              type="range"
              min="0"
              max="100"
              value={state?.red ?? 100}
              onChange={(e) => publish("rgb", { r: parseInt(e.target.value) })}
              disabled={loading}
            />
            <span className="value">{state?.red ?? 100}</span>
          </label>
          <label>
            Green
            <input
              type="range"
              min="0"
              max="100"
              value={state?.green ?? 100}
              onChange={(e) => publish("rgb", { g: parseInt(e.target.value) })}
              disabled={loading}
            />
            <span className="value">{state?.green ?? 100}</span>
          </label>
          <label>
            Blue
            <input
              type="range"
              min="0"
              max="100"
              value={state?.blue ?? 100}
              onChange={(e) => publish("rgb", { b: parseInt(e.target.value) })}
              disabled={loading}
            />
            <span className="value">{state?.blue ?? 100}</span>
          </label>
        </div>

        {/* Quick Presets */}
        <div className="control-group">
          <h4>Rychlé předvolby</h4>
          <div className="button-row">
            <button
              onClick={() => {
                publish("brightness", 100);
                publish("contrast", 100);
                publish("e2", 25);
                publish("mode", "games");
              }}
              disabled={loading}
            >
              💡 Maximum
            </button>
            <button
              onClick={() => {
                publish("brightness", 50);
                publish("contrast", 75);
                publish("mode", "standard");
              }}
              disabled={loading}
            >
              🌙 Noční režim
            </button>
            <button onClick={() => publish("refresh", "1")} disabled={loading}>
              🔄 Obnovit stav
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .monitor-state {
          background: var(--bg-secondary, #f5f5f5);
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1.5rem;
        }
        .monitor-state h3 {
          margin: 0 0 0.75rem 0;
          font-size: 1rem;
        }
        .state-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 0.5rem;
        }
        .state-grid div {
          font-size: 0.9rem;
        }
        .monitor-controls {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .control-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .control-group label {
          display: flex;
          align-items: center;
          gap: 1rem;
          font-weight: 500;
        }
        .control-group input[type="range"] {
          flex: 1;
          min-width: 200px;
        }
        .control-group .value {
          min-width: 50px;
          text-align: right;
          font-family: monospace;
          color: var(--text-secondary, #666);
        }
        .control-group select {
          padding: 0.5rem;
          border: 1px solid var(--border, #ccc);
          border-radius: 4px;
          background: white;
          font-size: 1rem;
        }
        .control-group h4 {
          margin: 0 0 0.5rem 0;
          font-size: 0.9rem;
          color: var(--text-secondary, #666);
        }
        .button-row {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .button-row button {
          padding: 0.5rem 1rem;
          border: 1px solid var(--border, #ccc);
          border-radius: 4px;
          background: white;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s;
        }
        .button-row button:hover:not(:disabled) {
          background: var(--bg-secondary, #f5f5f5);
          border-color: var(--primary, #007bff);
        }
        .button-row button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
