import { useState, useEffect, useRef } from "react";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import { getClient, publish } from "@/services/mqtt";

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
  const [localBrightness, setLocalBrightness] = useState(100);
  const [localContrast, setLocalContrast] = useState(100);
  const [localRed, setLocalRed] = useState(100);
  const [localGreen, setLocalGreen] = useState(100);
  const [localBlue, setLocalBlue] = useState(100);
  const [isChanging, setIsChanging] = useState(false);

  // Debounce timers
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const changingTimer = useRef<NodeJS.Timeout | null>(null);

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
    // Only sync from server state if user is not actively changing values
    if (state && !isChanging) {
      setLocalBrightness(state.brightness);
      setLocalContrast(state.contrast);
      setLocalRed(state.red);
      setLocalGreen(state.green);
      setLocalBlue(state.blue);
    }
  }, [state, isChanging]);

  const publishDebounced = (topic: string, value: string | number | object, delay = 300) => {
    // Clear existing timer for this topic
    if (debounceTimers.current[topic]) {
      clearTimeout(debounceTimers.current[topic]);
    }

    setIsChanging(true);

    // Set new timer
    debounceTimers.current[topic] = setTimeout(() => {
      const payload = typeof value === "object" ? JSON.stringify(value) : String(value);
      publish(`smartmirror/display/control/${topic}`, payload);

      // Daemon will publish updated state → our subscription will handle it
      // Allow UI sync 1s after last publish (daemon publishes after 500ms)
      if (changingTimer.current) clearTimeout(changingTimer.current);
      changingTimer.current = setTimeout(() => {
        setIsChanging(false);
      }, 1000);
    }, delay);
  };

  const publishControl = (topic: string, value: string | number | object) => {
    const payload = typeof value === "object" ? JSON.stringify(value) : String(value);
    publish(`smartmirror/display/control/${topic}`, payload);
    // Daemon will publish updated state → our subscription will handle it
  };

  const Slider = ({ label, value, min, max, on }: { label: string; value: number; min: number; max: number; on: (v: number) => void }) => (
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
        onChange={(e) => on(parseInt(e.target.value))}
        onInput={(e) => on(parseInt((e.target as HTMLInputElement).value))}
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
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease" }}>
      <p style={{ ...eyebrow, margin: "0 0 6px" }}>DDC/CI · Dell U2515H</p>
      <h2 style={{ ...h2, margin: "0 0 24px" }}>{en ? "Monitor Control" : "Ovládání monitoru"}</h2>

      {/* Current State */}
      <div style={{ marginBottom: 24, padding: 16, borderRadius: 16, border: `1px solid ${C.line}`, background: C.p2 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 12 }}>{en ? "Current State" : "Aktuální stav"}</div>
        {stateLoading ? (
          <div style={{ color: C.mute, fontSize: 13 }}>{en ? "Loading..." : "Načítání..."}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>
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
        on={(v) => {
          setLocalBrightness(v);
          publishDebounced("brightness", v);
        }}
      />
      <Slider
        label={en ? "Contrast" : "Kontrast"}
        value={localContrast}
        min={0}
        max={100}
        on={(v) => {
          setLocalContrast(v);
          publishDebounced("contrast", v);
        }}
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
        on={(v) => {
          setLocalRed(v);
          publishDebounced("rgb", { r: v, g: localGreen, b: localBlue });
        }}
      />
      <Slider
        label="Green"
        value={localGreen}
        min={0}
        max={100}
        on={(v) => {
          setLocalGreen(v);
          publishDebounced("rgb", { r: localRed, g: v, b: localBlue });
        }}
      />
      <Slider
        label="Blue"
        value={localBlue}
        min={0}
        max={100}
        on={(v) => {
          setLocalBlue(v);
          publishDebounced("rgb", { r: localRed, g: localGreen, b: v });
        }}
      />
    </section>
  );
}
