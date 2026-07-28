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
  const [draft, setDraft] = useState<MonitorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadState();
    const interval = setInterval(() => loadState(false), 30000);
    return () => clearInterval(interval);
  }, []);

  const loadState = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const data = await mqtt.sub("smartmirror/monitor/state", 1, 3000);
      if (data.messages?.length) {
        const msg = JSON.parse(data.messages[0].payload);
        setState(msg);
        setDraft(msg);
      }
    } catch (err) {
      console.error("Failed to load monitor state:", err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const publish = async (topic: string, value: string | number | object) => {
    try {
      const payload = typeof value === "object" ? JSON.stringify(value) : String(value);
      await mqtt.pub(`smartmirror/monitor/control/${topic}`, payload);
      // Reload state after 1 second
      setTimeout(loadState, 1000);
    } catch (err) {
      console.error("Publish failed:", err);
    }
  };

  const saveAll = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await mqtt.pub("smartmirror/monitor/control/brightness", String(draft.brightness));
      await new Promise(resolve => setTimeout(resolve, 300));
      await mqtt.pub("smartmirror/monitor/control/contrast", String(draft.contrast));
      await new Promise(resolve => setTimeout(resolve, 300));
      await mqtt.pub("smartmirror/monitor/control/rgb", JSON.stringify({ r: draft.red, g: draft.green, b: draft.blue }));
      // Wait for monitor to update, then reload
      setTimeout(() => {
        loadState();
        setSaving(false);
      }, 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaving(false);
    }
  };

  const updateDraft = (field: keyof MonitorState, value: number) => {
    setDraft(prev => prev ? { ...prev, [field]: value } : null);
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
      disabled={saving}
      style={{
        flex: 1,
        padding: "10px 16px",
        borderRadius: 12,
        border: `1px solid ${C.line}`,
        background: C.p3,
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: C.ink,
        cursor: saving ? "not-allowed" : "pointer",
        opacity: saving ? 0.5 : 1
      }}
    >
      {label}
    </button>
  );

  if (loading) {
    return (
      <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: `3px solid ${C.line}`, borderTop: `3px solid ${C.signal}`, borderRadius: "50%", margin: "0 auto 16px", animation: "mc-sweep .8s linear infinite" }} />
          <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>{en ? "Loading monitor state..." : "Načítám stav monitoru..."}</p>
        </div>
      </section>
    );
  }

  return (
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease" }}>
      <p style={{ ...eyebrow, margin: "0 0 6px" }}>DDC/CI · Dell U2515H</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={h2}>{en ? "Monitor" : "Monitor"}</h2>
      </div>

      {state && (
        <div style={{ background: C.p3, borderRadius: 12, padding: "12px 16px", marginBottom: 16, border: `1px solid ${C.line}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontFamily: "var(--mono)", fontSize: 10, color: C.mute }}>
            <div>
              <div style={{ marginBottom: 4 }}>{en ? "Brightness" : "Jas"}</div>
              <div style={{ color: C.ink, fontSize: 14 }}>{state.brightness}%</div>
            </div>
            <div>
              <div style={{ marginBottom: 4 }}>{en ? "Contrast" : "Kontrast"}</div>
              <div style={{ color: C.ink, fontSize: 14 }}>{state.contrast}%</div>
            </div>
            <div>
              <div style={{ marginBottom: 4 }}>RGB</div>
              <div style={{ color: C.ink, fontSize: 14 }}>
                {state.red}/{state.green}/{state.blue}
              </div>
            </div>
          </div>
        </div>
      )}

      <Slider label={en ? "Brightness" : "Jas"} value={draft?.brightness ?? 100} min={0} max={100} on={(v) => updateDraft("brightness", v)} />
      <Slider label={en ? "Contrast" : "Kontrast"} value={draft?.contrast ?? 100} min={0} max={100} on={(v) => updateDraft("contrast", v)} />

      <div style={{ marginTop: 24, marginBottom: 8 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 6 }}>{en ? "E2 Enhancement" : "E2 Vylepšení"}</div>
        <input type="range" min={0} max={25} defaultValue={25} onChange={(e) => publish("e2", parseInt(e.target.value))} style={{ width: "100%", accentColor: C.signal }} />
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Power" : "Napájení"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => publish("power", "on")} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}>
            ✓ {en ? "On" : "Zapnout"}
          </button>
          <button onClick={() => publish("power", "off")} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}>
            ✕ {en ? "Off" : "Vypnout"}
          </button>
        </div>
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
        <Slider label="Red" value={draft?.red ?? 100} min={0} max={100} on={(v) => updateDraft("red", v)} />
        <Slider label="Green" value={draft?.green ?? 100} min={0} max={100} on={(v) => updateDraft("green", v)} />
        <Slider label="Blue" value={draft?.blue ?? 100} min={0} max={100} on={(v) => updateDraft("blue", v)} />
      </div>

      <button
        onClick={saveAll}
        disabled={saving}
        style={{
          width: "100%",
          marginTop: 24,
          padding: "14px 20px",
          borderRadius: 12,
          border: "none",
          background: C.signal,
          color: C.paper,
          fontFamily: "var(--mono)",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 1,
          transition: "all .2s"
        }}
      >
        {saving ? (en ? "Saving..." : "Ukládám...") : (en ? "Save Settings" : "Uložit nastavení")}
      </button>

      <div style={{ marginTop: 24 }}>
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
    </section>
  );
}
