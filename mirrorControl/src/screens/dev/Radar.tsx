import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import { devActions } from "@/features/dev/devSlice";
import * as fx from "@/app/thunks";

const HX = 2.2; // half-width metres
const MY = 3; // reach metres
const xP = (m: number) => 50 + (m / HX) * 50;
const yP = (m: number) => (m / MY) * 100;

export default function Radar() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const d = useAppSelector((s) => s.dev);
  const active = d.radarActive;

  const zl = xP(d.zoneCx - d.zoneW / 2);
  const zr = xP(d.zoneCx + d.zoneW / 2);

  // prefer live MQTT targets; fall back to a demo target
  const targets = d.liveTargets.length
    ? d.liveTargets.map((t) => ({ x: t.x / 1000, y: t.y / 1000 }))
    : [{ x: 1.16, y: 1.45 }];

  const Slider = ({ label, value, min, max, step, on }: { label: string; value: number; min: number; max: number; step: number; on: (v: number) => void }) => (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color: C.ink }}>{value.toFixed(2)}</span>
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
        {/* sweep beam */}
        {active && (
          <div style={{ position: "absolute", top: 0, left: "50%", width: "70%", height: "100%", transformOrigin: "top center", background: "conic-gradient(from 90deg at 50% 0, transparent, rgba(59,209,122,.32), transparent 60deg)", animation: "mc-wiper 2.4s ease-in-out infinite alternate" }} />
        )}
        {/* target zone */}
        <div style={{ position: "absolute", top: 0, left: `${zl}%`, width: `${zr - zl}%`, height: `${yP(d.zoneFar)}%`, border: "1px solid rgba(59,209,122,.7)", background: "rgba(59,209,122,.08)" }}>
          <span style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", fontFamily: "var(--mono)", fontSize: 9, color: "rgba(59,209,122,.9)", whiteSpace: "nowrap" }}>target zone</span>
          <span style={{ position: "absolute", top: -7, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "7px solid #fff" }} />
        </div>
        {/* targets */}
        {targets.map((t, i) => (
          <span key={i} style={{ position: "absolute", left: `${xP(t.x)}%`, top: `${yP(t.y)}%`, transform: "translate(-50%,-50%)", width: 14, height: 14, borderRadius: "50%", background: "#ffc34d", boxShadow: "0 0 14px 3px rgba(255,195,77,.55)" }} />
        ))}
      </div>

      <Slider label={en ? "Position X" : "Poloha X"} value={d.zoneCx} min={-1} max={1} step={0.01} on={(v) => dispatch(devActions.setZoneCx(v))} />
      <Slider label={en ? "Width" : "Šířka"} value={d.zoneW} min={0.2} max={2} step={0.01} on={(v) => dispatch(devActions.setZoneW(v))} />
      <Slider label={en ? "Reach" : "Dosah"} value={d.zoneFar} min={0.5} max={3} step={0.01} on={(v) => dispatch(devActions.setZoneFar(v))} />
    </section>
  );
}
