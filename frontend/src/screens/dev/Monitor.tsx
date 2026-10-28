import { useState, useEffect, useRef } from "react";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import { Spinner } from "@/components/shell";
import {
  useGetDisplayStateQuery,
  useSetDisplayPowerMutation,
  useSetDisplayBrightnessMutation,
  useSetDisplayContrastMutation,
  useSetDisplayRgbMutation,
  useSetDisplayPresetMutation,
  useSetDisplayModeMutation,
  useSetDisplayE2Mutation,
} from "@/app/api/displayApi";

const PRESETS = [
  { value: "5000K", label: "5000K" },
  { value: "6500K", label: "6500K" },
  { value: "7500K", label: "7500K" },
  { value: "9300K", label: "9300K" },
  { value: "10000K", label: "10000K" },
  { value: "user1", label: "User 1" },
  { value: "user2", label: "User 2" },
];

const MODES = [
  { value: "standard", label: { cs: "Standard", en: "Standard" } },
  { value: "movie", label: { cs: "Film", en: "Movie" } },
  { value: "games", label: { cs: "Hry", en: "Games" } },
];

export default function Monitor() {
  const { en } = useT();
  // smartmirror/display/state is retained-pushed — this query's cache stays
  // live via its onCacheEntryAdded subscription, no manual MQTT listener.
  const { data: state, isLoading: stateLoading } = useGetDisplayStateQuery();
  const [setPower] = useSetDisplayPowerMutation();
  const [setBrightness] = useSetDisplayBrightnessMutation();
  const [setContrast] = useSetDisplayContrastMutation();
  const [setRgb] = useSetDisplayRgbMutation();
  const [setPreset] = useSetDisplayPresetMutation();
  const [setMode] = useSetDisplayModeMutation();
  const [setE2] = useSetDisplayE2Mutation();

  const [isUpdating, setIsUpdating] = useState(false);
  const [localBrightness, setLocalBrightness] = useState(100);
  const [localContrast, setLocalContrast] = useState(100);
  const [localRed, setLocalRed] = useState(100);
  const [localGreen, setLocalGreen] = useState(100);
  const [localBlue, setLocalBlue] = useState(100);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    // Sync local slider state from the daemon's pushed state, and clear the
    // loading overlay — the real confirmation that a control change applied.
    if (state && state.timestamp > 0) {
      if (state.brightness != null) setLocalBrightness(state.brightness);
      if (state.contrast != null) setLocalContrast(state.contrast);
      if (state.red != null) setLocalRed(state.red);
      if (state.green != null) setLocalGreen(state.green);
      if (state.blue != null) setLocalBlue(state.blue);
      setIsUpdating(false);
    }
  }, [state]);

  const debounced = (key: string, fn: () => void, delay = 300) => {
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => {
      setIsUpdating(true);
      fn();
    }, delay);
  };

  const immediate = (fn: () => void) => {
    setIsUpdating(true);
    fn();
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
    <button onClick={onClick} style={{ flex: 1, padding: "10px 16px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}>
      {label}
    </button>
  );

  return (
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease", position: "relative" }}>
      {isUpdating && (
        <div
          style={{
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
            animation: "scin .2s ease",
          }}
        >
          <Spinner color={C.signal} track="#f3c9c0" size={24} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>{en ? "Updating..." : "Aktualizuji..."}</span>
        </div>
      )}

      <p style={{ ...eyebrow, margin: "0 0 6px" }}>DDC/CI · Dell U2515H</p>
      <h2 style={{ ...h2, margin: "0 0 24px" }}>{en ? "Monitor Control" : "Ovládání monitoru"}</h2>

      <div style={{ marginBottom: 24, padding: 16, borderRadius: 16, border: `1px solid ${C.line}`, background: C.p2 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 12 }}>{en ? "Current State" : "Aktuální stav"}</div>
        {stateLoading || !state || state.timestamp === 0 ? (
          <div style={{ color: C.mute, fontSize: 13 }}>{en ? "Loading..." : "Načítání..."}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>
            <div>
              <div style={{ marginBottom: 4 }}>{en ? "Power" : "Napájení"}</div>
              <div style={{ color: state.power === 1 ? C.green : C.mute, fontSize: 14 }}>{state.power === 1 ? "ON" : state.power === 4 ? "STANDBY" : "—"}</div>
            </div>
            <div>
              <div style={{ marginBottom: 4 }}>{en ? "Brightness" : "Jas"}</div>
              <div style={{ color: C.ink, fontSize: 14 }}>{state.brightness ?? "—"}%</div>
            </div>
            <div>
              <div style={{ marginBottom: 4 }}>{en ? "Contrast" : "Kontrast"}</div>
              <div style={{ color: C.ink, fontSize: 14 }}>{state.contrast ?? "—"}%</div>
            </div>
            <div>
              <div style={{ marginBottom: 4 }}>RGB</div>
              <div style={{ color: C.ink, fontSize: 14 }}>{`${state.red}/${state.green}/${state.blue}`}</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Display" : "Displej"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => immediate(() => setPower("on"))} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}>
            ✓ {en ? "Wake Up" : "Probudit"}
          </button>
          <button onClick={() => immediate(() => setPower("standby"))} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}>
            ⏾ {en ? "Standby" : "Standby"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Quick Presets" : "Rychlé předvolby"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <QuickButton
            label={en ? "💡 Maximum" : "💡 Maximum"}
            onClick={() =>
              immediate(() => {
                setBrightness(100);
                setContrast(100);
                setE2(25);
                setMode("games");
              })
            }
          />
          <QuickButton
            label={en ? "🌙 Night" : "🌙 Noční"}
            onClick={() =>
              immediate(() => {
                setBrightness(50);
                setContrast(75);
                setMode("standard");
              })
            }
          />
        </div>
      </div>

      <Slider label={en ? "Brightness" : "Jas"} value={localBrightness} min={0} max={100} onChange={setLocalBrightness} onCommit={(v) => debounced("brightness", () => setBrightness(v))} />
      <Slider label={en ? "Contrast" : "Kontrast"} value={localContrast} min={0} max={100} onChange={setLocalContrast} onCommit={(v) => debounced("contrast", () => setContrast(v))} />

      <div style={{ marginTop: 24, marginBottom: 8 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 6 }}>{en ? "E2 Enhancement" : "E2 Vylepšení"}</div>
        <input type="range" min={0} max={25} defaultValue={25} onChange={(e) => immediate(() => setE2(parseInt(e.target.value)))} style={{ width: "100%", accentColor: C.signal, cursor: "pointer" }} />
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Display Mode" : "Režim zobrazení"}</div>
        <select onChange={(e) => immediate(() => setMode(e.target.value))} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {en ? m.label.en : m.label.cs}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{en ? "Color Preset" : "Teplota barev"}</div>
        <select onChange={(e) => immediate(() => setPreset(e.target.value))} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <Slider label="Red" value={localRed} min={0} max={100} onChange={setLocalRed} onCommit={(v) => debounced("rgb", () => setRgb({ r: v, g: localGreen, b: localBlue }))} />
      <Slider label="Green" value={localGreen} min={0} max={100} onChange={setLocalGreen} onCommit={(v) => debounced("rgb", () => setRgb({ r: localRed, g: v, b: localBlue }))} />
      <Slider label="Blue" value={localBlue} min={0} max={100} onChange={setLocalBlue} onCommit={(v) => debounced("rgb", () => setRgb({ r: localRed, g: localGreen, b: v }))} />
    </section>
  );
}
