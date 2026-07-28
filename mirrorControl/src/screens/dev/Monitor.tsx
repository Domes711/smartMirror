import { useState, useEffect } from "react";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import { mqtt } from "@/services/api";

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

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (state) {
      setLocalBrightness(state.brightness);
      setLocalContrast(state.contrast);
      setLocalRed(state.red);
      setLocalGreen(state.green);
      setLocalBlue(state.blue);
    }
  }, [state]);

  const loadState = async () => {
    setStateLoading(true);
    try {
      // Start listening for response first, then send request
      const subscribePromise = mqtt.sub("smartmirror/monitor/state", 1, 3000);
      // Small delay to ensure subscribe is ready
      await new Promise(resolve => setTimeout(resolve, 50));
      // Request fresh state from daemon
      await mqtt.pub("smartmirror/monitor/control/get_state", "1");
      // Wait for the response
      const data = await subscribePromise;
      if (data.messages?.length) {
        const msg = JSON.parse(data.messages[0].payload);
        setState(msg);
      }
    } catch (err) {
      console.error("Failed to load monitor state:", err);
    } finally {
      setStateLoading(false);
    }
  };

  const publish = async (topic: string, value: string | number | object) => {
    try {
      const payload = typeof value === "object" ? JSON.stringify(value) : String(value);
      await mqtt.pub(`smartmirror/monitor/control/${topic}`, payload);
      // Reload state after change
      setTimeout(loadState, 800);
    } catch (err) {
      console.error("Publish failed:", err);
    }
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={h2}>{en ? "Monitor" : "Monitor"}</h2>
      </div>

      {/* Current State Panel */}
      <div style={{ background: C.p3, borderRadius: 12, padding: "12px 16px", marginBottom: 16, border: `1px solid ${C.line}`, position: "relative" }}>
        {stateLoading && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(233, 232, 221, 0.8)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 24, height: 24, border: `2px solid ${C.line}`, borderTop: `2px solid ${C.signal}`, borderRadius: "50%", animation: "mc-sweep .8s linear infinite" }} />
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, fontFamily: "var(--mono)", fontSize: 10, color: C.mute }}>
          <div>
            <div style={{ marginBottom: 4 }}>{en ? "Display" : "Displej"}</div>
            <div style={{ color: state?.power === 1 ? "#1F8A3B" : "#E5482F", fontSize: 14, fontWeight: 700 }}>
              {state?.power === 1 ? "ON" : state?.power === 4 || state?.power === 5 ? "OFF" : "—"}
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
      </div>

      {/* Power Controls */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Display" : "Displej"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => publish("power", "on")} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}>
            ✓ {en ? "Wake Up" : "Probudit"}
          </button>
          <button onClick={() => publish("power", "standby")} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}>
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
              publish("brightness", 100);
              publish("contrast", 100);
              publish("e2", 25);
              publish("mode", "games");
            }}
          />
          <QuickButton
            label={en ? "🌙 Night" : "🌙 Noční"}
            onClick={() => {
              publish("brightness", 50);
              publish("contrast", 75);
              publish("mode", "standard");
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
          publish("brightness", v);
        }}
      />
      <Slider
        label={en ? "Contrast" : "Kontrast"}
        value={localContrast}
        min={0}
        max={100}
        on={(v) => {
          setLocalContrast(v);
          publish("contrast", v);
        }}
      />

      <div style={{ marginTop: 24, marginBottom: 8 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 6 }}>{en ? "E2 Enhancement" : "E2 Vylepšení"}</div>
        <input type="range" min={0} max={25} defaultValue={25} onChange={(e) => publish("e2", parseInt(e.target.value))} style={{ width: "100%", accentColor: C.signal, cursor: "pointer" }} />
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Display Mode" : "Režim zobrazení"}</div>
        <select onChange={(e) => publish("mode", e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {en ? m.label.en : m.label.cs}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Color Preset" : "Teplota barev"}</div>
        <select onChange={(e) => publish("preset", e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 12 }}>RGB Gain</div>
        <Slider
          label="Red"
          value={localRed}
          min={0}
          max={100}
          on={(v) => {
            setLocalRed(v);
            publish("rgb", { r: v });
          }}
        />
        <Slider
          label="Green"
          value={localGreen}
          min={0}
          max={100}
          on={(v) => {
            setLocalGreen(v);
            publish("rgb", { g: v });
          }}
        />
        <Slider
          label="Blue"
          value={localBlue}
          min={0}
          max={100}
          on={(v) => {
            setLocalBlue(v);
            publish("rgb", { b: v });
          }}
        />
      </div>
    </section>
  );
}
