import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import * as fx from "@/app/thunks";
import { useGetDistanceConfigQuery, useSetDistanceConfigMutation } from "@/app/api/distanceApi";
import {
  useGetRadarConfigQuery,
  useSetRadarConfigMutation,
  useCenterRadarOnNearestTargetMutation,
  useFlipRadarAxisMutation,
  useLearnRadarGhostsMutation,
  useResetRadarConfigMutation,
  useSetRadarStreamingMutation,
} from "@/app/api/radarApi";

const HX = 2.2; // half-width metres
const MY = 3; // reach metres
const xP = (m: number) => 50 + (m / HX) * 50;
const yP = (m: number) => (m / MY) * 100;

// Must be well under the daemon's STREAM_TIMEOUT_S (15s) so a renewal
// always lands before the broadcast auto-stops on its own.
const STREAM_RENEW_MS = 8000;

export default function Radar() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const d = useAppSelector((s) => s.dev);
  const active = d.radarActive;
  const distActive = d.distanceActive;

  const { data: distCfg } = useGetDistanceConfigQuery();
  const [setDistanceConfig] = useSetDistanceConfigMutation();

  const { data: radarCfg } = useGetRadarConfigQuery();
  const [setRadarConfig] = useSetRadarConfigMutation();
  const [centerOnTarget] = useCenterRadarOnNearestTargetMutation();
  const [flipAxis] = useFlipRadarAxisMutation();
  const [learnGhosts] = useLearnRadarGhostsMutation();
  const [resetConfig] = useResetRadarConfigMutation();
  const [setStreaming] = useSetRadarStreamingMutation();

  // Live targets cost the daemon a broadcast ~10x/second — only worth it
  // while this screen is actually open. Start on mount, renew periodically
  // (the daemon auto-stops after 15s of silence), stop on unmount.
  useEffect(() => {
    setStreaming(true);
    const renew = setInterval(() => setStreaming(true), STREAM_RENEW_MS);
    return () => {
      clearInterval(renew);
      setStreaming(false);
    };
  }, [setStreaming]);

  // Targets arrive already offset/mirror-corrected (daemon.py's apply_axis
  // runs before publish), so the detection zone on the map is always
  // centered on 0 — zone.x/zone.y are the backend's real half-width/depth,
  // no separate visual "position" slider needed.
  const zoneXm = (radarCfg?.zone?.x ?? 400) / 1000;
  const zoneYm = (radarCfg?.zone?.y ?? 1500) / 1000;
  const zl = xP(-zoneXm);
  const zr = xP(zoneXm);

  // Real MQTT targets only — an empty array means the radar confirmed
  // nobody is in range, so the map must show nothing, not a stale demo dot.
  const targets = d.liveTargets.map((t) => ({ x: t.x / 1000, y: t.y / 1000 }));

  const Slider = ({ label, value, min, max, step, on, fmt }: { label: string; value: number; min: number; max: number; step: number; on: (v: number) => void; fmt?: (v: number) => string }) => (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color: C.ink }}>{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(parseFloat(e.target.value))} style={{ width: "100%", accentColor: C.signal }} />
    </div>
  );

  return (
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease" }}>
      <p style={{ ...eyebrow, margin: "0 0 6px" }}>mmWave · 60GHz · LD2410</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={h2}>{L.navRadar}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => dispatch(fx.toggleRadar())} style={{ width: 48, height: 28, borderRadius: 999, border: `1px solid ${active ? C.ink : C.line}`, background: active ? C.ink : C.p3, position: "relative", cursor: "pointer", padding: 0 }}>
            <span style={{ position: "absolute", top: 2, left: active ? 22 : 2, width: 22, height: 22, borderRadius: "50%", background: active ? C.paper : C.ink, transition: ".18s" }} />
          </button>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{active ? (en ? "Active" : "Aktivní") : en ? "Off" : "Vypnuto"}</span>
        </div>
      </div>

      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(59,138,79,.12)", border: "1px solid rgba(59,138,79,.4)", borderRadius: 999, padding: "6px 12px", marginBottom: 14 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3bd17a" }} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>{en ? "motion detected" : "pohyb detekován"}</span>
      </div>

      <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 16, overflow: "hidden", background: "#0c0d0b", border: "1px solid #20211d" }}>
        {/* grid */}
        <div style={{ position: "absolute", left: 0, right: 0, top: "33.3%", borderTop: "1px dashed rgba(233,232,221,.12)" }} />
        <span style={{ position: "absolute", left: 8, top: "33.3%", transform: "translateY(-50%)", fontFamily: "var(--mono)", fontSize: 9, color: "rgba(233,232,221,.4)" }}>1 m</span>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", borderLeft: "1px dashed rgba(233,232,221,.12)" }} />
        {/* target zone */}
        <div style={{ position: "absolute", top: 0, left: `${zl}%`, width: `${zr - zl}%`, height: `${yP(zoneYm)}%`, border: "1px solid rgba(59,209,122,.7)", background: "rgba(59,209,122,.08)" }}>
          <span style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", fontFamily: "var(--mono)", fontSize: 9, color: "rgba(59,209,122,.9)", whiteSpace: "nowrap" }}>target zone</span>
          <span style={{ position: "absolute", top: -7, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "7px solid #fff" }} />
        </div>
        {/* targets */}
        {targets.map((t, i) => (
          <span key={i} style={{ position: "absolute", left: `${xP(t.x)}%`, top: `${yP(t.y)}%`, transform: "translate(-50%,-50%)", width: 14, height: 14, borderRadius: "50%", background: "#ffc34d", boxShadow: "0 0 14px 3px rgba(255,195,77,.55)" }} />
        ))}
      </div>

      <Slider
        label={en ? "Zone half-width" : "Poloviční šířka zóny"}
        value={zoneXm}
        min={0.1}
        max={2}
        step={0.01}
        fmt={(v) => `${v.toFixed(2)} m`}
        on={(v) => setRadarConfig({ zone: { x: Math.round(v * 1000), y: radarCfg?.zone?.y ?? 1500 } })}
      />
      <Slider
        label={en ? "Zone reach" : "Dosah zóny"}
        value={zoneYm}
        min={0.3}
        max={6}
        step={0.01}
        fmt={(v) => `${v.toFixed(2)} m`}
        on={(v) => setRadarConfig({ zone: { x: radarCfg?.zone?.x ?? 400, y: Math.round(v * 1000) } })}
      />
      <Slider
        label={en ? "X offset" : "Posun X"}
        value={(radarCfg?.x_offset ?? 0) / 1000}
        min={-2}
        max={2}
        step={0.01}
        fmt={(v) => `${v.toFixed(2)} m`}
        on={(v) => setRadarConfig({ x_offset: Math.round(v * 1000) })}
      />
      <Slider
        label={en ? "Entry debounce" : "Debounce vstupu"}
        value={radarCfg?.enter_frames ?? 3}
        min={1}
        max={10}
        step={1}
        fmt={(v) => `${Math.round(v)}×`}
        on={(v) => setRadarConfig({ enter_frames: Math.round(v) })}
      />
      <Slider
        label={en ? "Max range" : "Max. dosah"}
        value={(radarCfg?.max_range_mm ?? 6000) / 1000}
        min={1}
        max={6}
        step={0.1}
        fmt={(v) => `${v.toFixed(1)} m`}
        on={(v) => setRadarConfig({ max_range_mm: Math.round(v * 1000) })}
      />
      <Slider
        label={en ? "Smoothing (alpha)" : "Vyhlazení (alpha)"}
        value={radarCfg?.alpha ?? 0.3}
        min={0.05}
        max={1}
        step={0.05}
        fmt={(v) => v.toFixed(2)}
        on={(v) => setRadarConfig({ alpha: Math.round(v * 100) / 100 })}
      />
      <Slider
        label={en ? "Position deadband" : "Mrtvá zóna pozice"}
        value={radarCfg?.deadband_mm ?? 60}
        min={0}
        max={300}
        step={10}
        fmt={(v) => `${Math.round(v)} mm`}
        on={(v) => setRadarConfig({ deadband_mm: Math.round(v) })}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>{en ? "Mirror left/right" : "Zrcadlit vlevo/vpravo"}</span>
        <button
          onClick={() => setRadarConfig({ invert_x: !(radarCfg?.invert_x ?? false) })}
          style={{ width: 48, height: 28, borderRadius: 999, border: `1px solid ${radarCfg?.invert_x ? C.ink : C.line}`, background: radarCfg?.invert_x ? C.ink : C.p3, position: "relative", cursor: "pointer", padding: 0 }}
        >
          <span style={{ position: "absolute", top: 2, left: radarCfg?.invert_x ? 22 : 2, width: 22, height: 22, borderRadius: "50%", background: radarCfg?.invert_x ? C.paper : C.ink, transition: ".18s" }} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => centerOnTarget()}
          style={{ flex: "1 1 auto", padding: "10px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}
        >
          {en ? "Center on me" : "Vycentrovat na mě"}
        </button>
        <button
          onClick={() => flipAxis()}
          style={{ flex: "1 1 auto", padding: "10px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}
        >
          {en ? "Flip axis" : "Překlopit osu"}
        </button>
        <button
          onClick={() => learnGhosts(10)}
          style={{ flex: "1 1 auto", padding: "10px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}
        >
          {en ? "Learn ghosts (10s)" : "Naučit duchy (10s)"}
        </button>
        <button
          onClick={() => resetConfig()}
          style={{ flex: "1 1 auto", padding: "10px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}
        >
          {en ? "Reset" : "Reset"}
        </button>
      </div>

      {/* --- distance sensor (HC-SR04) ----------------------------------- */}
      <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
        <p style={{ ...eyebrow, margin: "0 0 6px" }}>ultrasonic · HC-SR04</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={h2}>{en ? "Distance" : "Vzdálenost"}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => dispatch(fx.toggleDistance())} style={{ width: 48, height: 28, borderRadius: 999, border: `1px solid ${distActive ? C.ink : C.line}`, background: distActive ? C.ink : C.p3, position: "relative", cursor: "pointer", padding: 0 }}>
              <span style={{ position: "absolute", top: 2, left: distActive ? 22 : 2, width: 22, height: 22, borderRadius: "50%", background: distActive ? C.paper : C.ink, transition: ".18s" }} />
            </button>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{distActive ? (en ? "Active" : "Aktivní") : en ? "Off" : "Vypnuto"}</span>
          </div>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: d.distanceNear ? "rgba(217,97,74,.12)" : "rgba(59,138,79,.12)",
            border: `1px solid ${d.distanceNear ? "rgba(217,97,74,.4)" : "rgba(59,138,79,.4)"}`,
            borderRadius: 999,
            padding: "6px 12px",
            marginBottom: 14,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.distanceCm == null ? C.mute : d.distanceNear ? "#d9614a" : "#3bd17a" }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
            {d.distanceCm == null ? (en ? "no echo" : "bez odezvy") : `${d.distanceCm.toFixed(1)} cm`}
          </span>
        </div>

        <Slider
          label={en ? "Near threshold" : "Práh blízkosti"}
          value={distCfg?.warn_cm ?? 30}
          min={2}
          max={400}
          step={1}
          fmt={(v) => `${Math.round(v)} cm`}
          on={(v) => setDistanceConfig({ warn_cm: Math.round(v) })}
        />
        <Slider
          label={en ? "Max range" : "Max. dosah"}
          value={distCfg?.max_range_cm ?? 400}
          min={50}
          max={400}
          step={10}
          fmt={(v) => `${Math.round(v)} cm`}
          on={(v) => setDistanceConfig({ max_range_cm: Math.round(v) })}
        />
        <Slider
          label={en ? "Averaging window" : "Okno průměrování"}
          value={distCfg?.avg_window_ms ?? 1000}
          min={200}
          max={10000}
          step={200}
          fmt={(v) => `${Math.round(v)} ms`}
          on={(v) => setDistanceConfig({ avg_window_ms: Math.round(v) })}
        />
        <Slider
          label={en ? "Readings before absent" : "Čtení před nepřítomností"}
          value={distCfg?.absent_after_n ?? 3}
          min={1}
          max={10}
          step={1}
          fmt={(v) => `${Math.round(v)}×`}
          on={(v) => setDistanceConfig({ absent_after_n: Math.round(v) })}
        />
      </div>
    </section>
  );
}
