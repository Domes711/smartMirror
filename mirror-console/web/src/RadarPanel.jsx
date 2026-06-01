import { useCallback, useEffect, useRef, useState } from "react";

// View window in mm: ±X_RANGE wide, Y_RANGE deep (radar sits at the top center).
const X_RANGE = 2000;
const Y_RANGE = 3000;
const W = 400;
const H = 300;
const STALE_MS = 2500;

const sx = (x) => ((x + X_RANGE) / (2 * X_RANGE)) * W;
const sy = (y) => (y / Y_RANGE) * H;

export default function RadarPanel() {
  const [radar, setRadar] = useState(null); // {active, available}
  const [toggling, setToggling] = useState(false);
  const [frame, setFrame] = useState({ targets: [], present: false, zone: { x: 400, y: 1500 } });
  const [, setTick] = useState(0);
  const lastTs = useRef(0);

  // radar service status
  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/radar");
      const b = await r.json();
      if (r.ok) setRadar(b);
    } catch {
      setRadar({ active: false, available: false });
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 3000);
    return () => clearInterval(id);
  }, [loadStatus]);

  // 1 Hz tick so "stale" recomputes even without new frames
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // live targets + presence over the shared MQTT SSE feed
  useEffect(() => {
    const es = new EventSource("/api/mqtt/stream");
    es.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.system) return;
        if (m.topic === "smartmirror/radar/targets") {
          const p = JSON.parse(m.payload);
          lastTs.current = Date.now();
          setFrame({
            targets: p.targets || [],
            present: !!p.present,
            zone: p.zone || { x: 400, y: 1500 },
          });
        } else if (m.topic === "smartmirror/radar/presence") {
          setFrame((f) => ({ ...f, present: m.payload === "present" }));
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  const toggle = useCallback(async () => {
    if (!radar) return;
    setToggling(true);
    try {
      const r = await fetch("/radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !radar.active }),
      });
      const b = await r.json();
      if (r.ok) setRadar(b);
    } catch {
      /* ignore */
    } finally {
      setToggling(false);
    }
  }, [radar]);

  const active = radar?.active;
  const stale = !active || Date.now() - lastTs.current > STALE_MS;
  const zone = frame.zone;
  const inZone = (x, y) => Math.abs(x) <= zone.x && y > 0 && y <= zone.y;
  const targets = stale ? [] : frame.targets;
  const present = !stale && frame.present;

  return (
    <div className="panel">
      <div className="panel-head radar-head">
        <span className={"pill " + (present ? "pill-live" : "pill-warn")}>
          ● {!radar?.available ? "radar nenalezen" : !active ? "radar vypnut" : present ? "pohyb detekován" : "klid"}
        </span>
        <label className="switch">
          <input
            type="checkbox"
            checked={!!active}
            disabled={toggling || !radar?.available}
            onChange={toggle}
          />
          <span className="switch-track" />
          <span className="switch-label">{active ? "Aktivní" : "Vypnuto"}</span>
        </label>
      </div>

      <div className="card radar-card">
        <svg className="radar-map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          {/* range guide rings (1m,2m,3m) */}
          {[1000, 2000, 3000].map((r) => (
            <g key={r}>
              <line x1="0" y1={sy(r)} x2={W} y2={sy(r)} className="radar-grid" />
              <text x="4" y={sy(r) - 3} className="radar-tick">{r / 1000} m</text>
            </g>
          ))}
          <line x1={sx(0)} y1="0" x2={sx(0)} y2={H} className="radar-grid" />

          {/* detection / target zone */}
          <rect
            x={sx(-zone.x)}
            y={sy(0)}
            width={sx(zone.x) - sx(-zone.x)}
            height={sy(zone.y) - sy(0)}
            className={"radar-zone" + (present ? " active" : "")}
          />
          <text x={sx(0)} y={sy(zone.y) - 6} className="radar-zone-label">
            target zone
          </text>

          {/* radar at top center */}
          <polygon points={`${W / 2 - 7},0 ${W / 2 + 7},0 ${W / 2},14`} className="radar-origin" />

          {/* live targets */}
          {targets.map(([x, y], i) => {
            const cx = sx(x);
            const cy = sy(y);
            if (cx < 0 || cx > W || cy < 0 || cy > H) return null;
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r="6" className={"radar-target" + (inZone(x, y) ? " in" : "")} />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="radar-info">
        {stale ? (
          <span className="monitor-empty">
            {active ? "Čekám na data z radaru…" : "Radar je vypnutý — zapni přepínačem."}
          </span>
        ) : (
          <div className="radar-targets">
            <strong>{targets.length} cíl(ů)</strong>
            {targets.map(([x, y], i) => (
              <span key={i} className={"radar-chip" + (inZone(x, y) ? " in" : "")}>
                x {(x / 1000).toFixed(2)} m · y {(y / 1000).toFixed(2)} m
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="profiles-note">
        Zóna {zone.x * 2 / 1000} m šířka × {zone.y / 1000} m hloubka — v ní se odešle{" "}
        <code>presence: present</code>. Vypnutý radar neposílá žádné MQTT zprávy.
      </p>
    </div>
  );
}
