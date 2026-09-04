import { useState, useEffect, useRef } from "react";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import { getClient, publish } from "@/services/mqtt";
import { Spinner } from "@/components/shell";

interface MonitorState {
  brightness: number;
  contrast: number;
  red: number;
  green: number;
  blue: number;
  power?: number;
}

const PRESETS = [
  { value: "5000K", label: "5000K" },
  { value: "6500K", label: "6500K" },
  { value: "7500K", label: "7500K" },
  { value: "9300K", label: "9300K" },
  { value: "10000K", label: "10000K" },
  { value: "user1", label: "User 1" },
  { value: "user2", label: "User 2" }
];

const MODES = [
  { value: "standard", label: { cs: "Standard", en: "Standard" } },
  { value: "movie", label: { cs: "Film", en: "Movie" } },
  { value: "games", label: { cs: "Hry", en: "Games" } }
];

export default function Monitor() {
  const { en } = useT();
  const [state, setState] = useState<MonitorState | null>(null);
  const [stateLoading, setStateLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [localBrightness, setLocalBrightness] = useState(100);
  const [localContrast, setLocalContrast] = useState(100);
  const [localRed, setLocalRed] = useState(100);
  const [localGreen, setLocalGreen] = useState(100);
  const [localBlue, setLocalBlue] = useState(100);

  // Debounce timers
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // Subscribe to monitor state updates (event-driven, not polling)
  useEffect(() => {
    const client = getClient();
    if (!client) {
      console.warn("MQTT client not connected yet");
      setStateLoading(false);
      return;
    }

    const handleMessage = (topic: string, payload: Buffer) => {
      if (topic === "smartmirror/display/state") {
        try {
          const newState = JSON.parse(payload.toString());
          setState(newState);
          setStateLoading(false);
        } catch (err) {
          console.error("Failed to parse monitor state:", err);
        }
      }
    };

    // Subscribe to MQTT messages
    client.on("message", handleMessage);

    // Request initial state
    publish("smartmirror/display/control/get_state", "1");

    // Cleanup: remove listener on unmount
    return () => {
      client.off("message", handleMessage);
    };
  }, []);

  useEffect(() => {
    // Sync from server state when it changes
    if (state) {
      setLocalBrightness(state.brightness);
      setLocalContrast(state.contrast);
      setLocalRed(state.red);
      setLocalGreen(state.green);
      setLocalBlue(state.blue);
      // Turn off loader when new state arrives
      setIsUpdating(false);
    }
  }, [state]);

  const publishDebounced = (topic: string, value: string | number | object, delay = 300) => {
    // Clear existing timer for this topic
    if (debounceTimers.current[topic]) {
      clearTimeout(debounceTimers.current[topic]);
    }

    // Set new timer
    debounceTimers.current[topic] = setTimeout(() => {
      setIsUpdating(true);
      const payload = typeof value === "object" ? JSON.stringify(value) : String(value);
      publish(`smartmirror/display/control/${topic}`, payload);
      // Daemon will publish updated state → our subscription will handle it
    }, delay);
  };

  const publishControl = (topic: string, value: string | number | object) => {
    setIsUpdating(true);
    const payload = typeof value === "object" ? JSON.stringify(value) : String(value);
    publish(`smartmirror/display/control/${topic}`, payload);
    // Daemon will publish updated state → our subscription will handle it
  };

  const Slider = ({ label, value, min, max, onChange, onCommit }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; onCommit: (v: number) => void }) => (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color: C.ink }}>{value}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onInput={(e) => onChange(parseInt((e.target as HTMLInputElement).value))}
        onChange={(e) => onCommit(parseInt(e.target.value))}
        style={{ width: "100%", accentColor: C.signal, cursor: "pointer" }}
      />
    </div>
  );

  const QuickButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 16px",
        borderRadius: 12,
        border: `1px solid ${C.line}`,
        background: C.p3,
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: C.ink,
        cursor: "pointer"
      }}
    >
      {label}
    </button>
  );

  return (
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease", position: "relative" }}>
      {/* Loading overlay */}
      {isUpdating && (
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(255, 255, 255, 0.85)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          zIndex: 10,
          animation: "scin .2s ease"
        }}>
          <Spinner color={C.signal} track="#f3c9c0" size={24} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>
            {en ? "Updating..." : "Aktualizuji..."}
          </span>
        </div>
      )}

      <p style={{ ...eyebrow, margin: "0 0 6px" }}>DDC/CI · Dell U2515H</p>
      <h2 style={{ ...h2, margin: "0 0 24px" }}>{en ? "Monitor Control" : "Ovládání monitoru"}</h2>

      {/* Current State */}
      <div style={{ marginBottom: 24, padding: 16, borderRadius: 16, border: `1px solid ${C.line}`, background: C.p2 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 12 }}>{en ? "Current State" : "Aktuální stav"}</div>
        {stateLoading ? (
          <div style={{ color: C.mute, fontSize: 13 }}>{en ? "Loading..." : "Načítání..."}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>
            <div>
              <div style={{ marginBottom: 4 }}>{en ? "Power" : "Napájení"}</div>
              <div style={{ color: state?.power === 1 ? C.green : C.mute, fontSize: 14 }}>
                {state?.power === 1 ? "ON" : state?.power === 4 ? "STANDBY" : "—"}
              </div>
            </div>
            <div>
              <div style={{ marginBottom: 4 }}>{en ? "Brightness" : "Jas"}</div>
              <div style={{ color: C.ink, fontSize: 14 }}>{state?.brightness ?? "—"}%</div>
            </div>
            <div>
              <div style={{ marginBottom: 4 }}>{en ? "Contrast" : "Kontrast"}</div>
              <div style={{ color: C.ink, fontSize: 14 }}>{state?.contrast ?? "—"}%</div>
            </div>
            <div>
              <div style={{ marginBottom: 4 }}>RGB</div>
              <div style={{ color: C.ink, fontSize: 14 }}>
                {state ? `${state.red}/${state.green}/${state.blue}` : "—"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Power Controls */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Display" : "Displej"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => publishControl("power", "on")} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}>
            ✓ {en ? "Wake Up" : "Probudit"}
          </button>
          <button onClick={() => publishControl("power", "standby")} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}>
            ⏾ {en ? "Standby" : "Standby"}
          </button>
        </div>
      </div>

      {/* Quick Presets */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Quick Presets" : "Rychlé předvolby"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <QuickButton
            label={en ? "💡 Maximum" : "💡 Maximum"}
            onClick={() => {
              publishControl("brightness", 100);
              publishControl("contrast", 100);
              publishControl("e2", 25);
              publishControl("mode", "games");
            }}
          />
          <QuickButton
            label={en ? "🌙 Night" : "🌙 Noční"}
            onClick={() => {
              publishControl("brightness", 50);
              publishControl("contrast", 75);
              publishControl("mode", "standard");
            }}
          />
        </div>
      </div>

      <Slider
        label={en ? "Brightness" : "Jas"}
        value={localBrightness}
        min={0}
        max={100}
        onChange={(v) => setLocalBrightness(v)}
        onCommit={(v) => publishDebounced("brightness", v)}
      />
      <Slider
        label={en ? "Contrast" : "Kontrast"}
        value={localContrast}
        min={0}
        max={100}
        onChange={(v) => setLocalContrast(v)}
        onCommit={(v) => publishDebounced("contrast", v)}
      />

      <div style={{ marginTop: 24, marginBottom: 8 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 6 }}>{en ? "E2 Enhancement" : "E2 Vylepšení"}</div>
        <input type="range" min={0} max={25} defaultValue={25} onChange={(e) => publishControl("e2", parseInt(e.target.value))} style={{ width: "100%", accentColor: C.signal, cursor: "pointer" }} />
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Display Mode" : "Režim zobrazení"}</div>
        <select onChange={(e) => publishControl("mode", e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {en ? m.label.en : m.label.cs}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Color Preset" : "Teplota barev"}</div>
        <select onChange={(e) => publishControl("preset", e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <Slider
        label="Red"
        value={localRed}
        min={0}
        max={100}
        onChange={(v) => setLocalRed(v)}
        onCommit={(v) => publishDebounced("rgb", { r: v, g: localGreen, b: localBlue })}
      />
      <Slider
        label="Green"
        value={localGreen}
        min={0}
        max={100}
        onChange={(v) => setLocalGreen(v)}
        onCommit={(v) => publishDebounced("rgb", { r: localRed, g: v, b: localBlue })}
      />
      <Slider
        label="Blue"
        value={localBlue}
        min={0}
        max={100}
        onChange={(v) => setLocalBlue(v)}
        onCommit={(v) => publishDebounced("rgb", { r: localRed, g: localGreen, b: v })}
      />
    </section>
  );
}
