import { useCallback, useEffect, useRef, useState } from "react";

// View window in mm: ±X_RANGE wide, Y_RANGE deep (radar sits at the top center).
const X_RANGE = 2000;
const Y_RANGE = 3000;
const W = 400;
const H = 300;
const STALE_MS = 2500;
const CONTROL_TOPIC = "smartmirror/radar/control";

const sx = (x) => ((x + X_RANGE) / (2 * X_RANGE)) * W;
const sy = (y) => (y / Y_RANGE) * H;
const m = (mm) => (mm / 1000).toFixed(2);

export default function RadarPanel() {
  const [radar, setRadar] = useState(null); // {active, available}
  const [toggling, setToggling] = useState(false);
  const [frame, setFrame] = useState({ targets: [], present: false, zone: { x: 400, y: 1500 } });
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(null);
  const [calibMsg, setCalibMsg] = useState(null);
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

  const publishControl = useCallback(
    (payload) =>
      fetch("/api/mqtt/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: CONTROL_TOPIC, payload }),
      }).catch(() => {}),
    []
  );

  // live targets + presence + config over the shared MQTT SSE feed
  useEffect(() => {
    const es = new EventSource("/api/mqtt/stream");
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.system) return;
        if (msg.topic === "smartmirror/radar/targets") {
          const p = JSON.parse(msg.payload);
          lastTs.current = Date.now();
          setFrame({
            targets: p.targets || [],
            present: !!p.present,
            zone: p.zone || { x: 400, y: 1500 },
          });
        } else if (msg.topic === "smartmirror/radar/presence") {
          setFrame((f) => ({ ...f, present: msg.payload === "present" }));
        } else if (msg.topic === "smartmirror/radar/config") {
          setConfig(JSON.parse(msg.payload));
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  // ask the daemon to publish its current config once we're listening
  useEffect(() => {
    if (radar?.active) publishControl({ cmd: "get_config" });
  }, [radar?.active, publishControl]);

  // sync the editable form when config arrives
  useEffect(() => {
    if (config && !form) {
      setForm({
        alpha: config.alpha,
        deadband_mm: config.deadband_mm,
        enter_frames: config.enter_frames,
        zoneX: config.zone?.x,
        zoneY: config.zone?.y,
      });
    }
  }, [config, form]);

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

  const calibrate = useCallback(
    (payload, msg, ms = 2500) => {
      publishControl(payload);
      if (msg) {
        setCalibMsg(msg);
        setTimeout(() => setCalibMsg(null), ms);
      }
    },
    [publishControl]
  );

  const saveParams = useCallback(() => {
    if (!form) return;
    calibrate(
      {
        cmd: "set_config",
        config: {
          alpha: Number(form.alpha),
          deadband_mm: Number(form.deadband_mm),
          enter_frames: Number(form.enter_frames),
          zone: { x: Number(form.zoneX), y: Number(form.zoneY) },
        },
      },
      "Uloženo."
    );
  }, [form, calibrate]);

  const active = radar?.active;
  const stale = !active || Date.now() - lastTs.current > STALE_MS;
  const zone = frame.zone;
  const inZone = (x, y) => Math.abs(x) <= zone.x && y > 0 && y <= zone.y;
  const targets = stale ? [] : frame.targets;
  const present = !stale && frame.present;
  const exclusions = config?.exclusions || [];
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="panel">
      <div className="panel-head radar-head">
        <span className={"pill " + (present ? "pill-live" : "pill-warn")}>
          ● {!radar?.available ? "radar nenalezen" : !active ? "radar vypnut" : present ? "pohyb detekován" : "klid"}
        </span>
        <label className="switch">
          <input type="checkbox" checked={!!active} disabled={toggling || !radar?.available} onChange={toggle} />
          <span className="switch-track" />
          <span className="switch-label">{active ? "Aktivní" : "Vypnuto"}</span>
        </label>
      </div>

      <div className="card radar-card">
        <svg className="radar-map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          {[1000, 2000, 3000].map((r) => (
            <g key={r}>
              <line x1="0" y1={sy(r)} x2={W} y2={sy(r)} className="radar-grid" />
              <text x="4" y={sy(r) - 3} className="radar-tick">{r / 1000} m</text>
            </g>
          ))}
          <line x1={sx(0)} y1="0" x2={sx(0)} y2={H} className="radar-grid" />

          {/* learned ghost spots (baseline exclusions) */}
          {exclusions.map(([ex, ey], i) => {
            const cx = sx(ex);
            const cy = sy(ey);
            if (cx < 0 || cx > W || cy < 0 || cy > H) return null;
            return <circle key={`e${i}`} cx={cx} cy={cy} r="3" className="radar-excl" />;
          })}

          <rect
            x={sx(-zone.x)}
            y={sy(0)}
            width={sx(zone.x) - sx(-zone.x)}
            height={sy(zone.y) - sy(0)}
            className={"radar-zone" + (present ? " active" : "")}
          />
          <text x={sx(0)} y={sy(zone.y) - 6} className="radar-zone-label">target zone</text>

          <polygon points={`${W / 2 - 7},0 ${W / 2 + 7},0 ${W / 2},14`} className="radar-origin" />

          {targets.map(([x, y], i) => {
            const cx = sx(x);
            const cy = sy(y);
            if (cx < 0 || cx > W || cy < 0 || cy > H) return null;
            return <circle key={i} cx={cx} cy={cy} r="6" className={"radar-target" + (inZone(x, y) ? " in" : "")} />;
          })}
        </svg>
      </div>

      <div className="radar-info">
        {stale ? (
          <span className="monitor-empty">{active ? "Čekám na data z radaru…" : "Radar je vypnutý — zapni přepínačem."}</span>
        ) : (
          <div className="radar-targets">
            <strong>{targets.length} cíl(ů)</strong>
            {targets.map(([x, y], i) => (
              <span key={i} className={"radar-chip" + (inZone(x, y) ? " in" : "")}>
                x {m(x)} m · y {m(y)} m
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ---- calibration ---- */}
      <div className="card calib">
        <div className="calib-head">
          <h3>Kalibrace</h3>
          {calibMsg && <span className="hint-ok">{calibMsg}</span>}
        </div>

        {!active ? (
          <span className="monitor-empty">Zapni radar pro kalibraci.</span>
        ) : (
          <>
            <div className="calib-actions">
              <button
                className="mqtt-btn"
                onClick={() => calibrate({ cmd: "baseline", seconds: 10 }, "Nahrávám pozadí ~10 s — opusť prostor…", 10000)}
                title="Odejdi z prostoru; naučí a vyloučí ghost místa"
              >
                Kalibrovat pozadí (10 s)
              </button>
              <button
                className="mqtt-btn"
                onClick={() => calibrate({ cmd: "set_center" }, "Střed nastaven.")}
                title="Postav se přímo před zrcadlo a klikni"
              >
                Nastav střed
              </button>
              <button
                className="mqtt-btn"
                onClick={() => calibrate({ cmd: "set_axis", direction: "right" }, "Směr ověřen.")}
                title="Po nastavení středu udělej krok doprava a klikni"
              >
                Detekuj směr (krok vpravo)
              </button>
              <button
                className="mqtt-btn k-bad"
                onClick={() => calibrate({ cmd: "reset" }, "Obnoveno na výchozí.")}
              >
                Reset
              </button>
            </div>

            {form && (
              <div className="calib-params">
                <label className="field">
                  <span>Vyhlazení (alpha) — {form.alpha}</span>
                  <input type="range" min="0.05" max="0.9" step="0.05" value={form.alpha}
                    onChange={(e) => setField("alpha", e.target.value)} />
                </label>
                <label className="field">
                  <span>Deadband (mm) — {form.deadband_mm}</span>
                  <input type="range" min="0" max="300" step="10" value={form.deadband_mm}
                    onChange={(e) => setField("deadband_mm", e.target.value)} />
                </label>
                <label className="field">
                  <span>Debounce vstupu (snímky) — {form.enter_frames}</span>
                  <input type="range" min="1" max="10" step="1" value={form.enter_frames}
                    onChange={(e) => setField("enter_frames", e.target.value)} />
                </label>
                <div className="calib-zone">
                  <label className="field">
                    <span>Zóna šířka ± (mm)</span>
                    <input type="number" min="100" max="2000" step="50" value={form.zoneX}
                      onChange={(e) => setField("zoneX", e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Zóna hloubka (mm)</span>
                    <input type="number" min="300" max="6000" step="100" value={form.zoneY}
                      onChange={(e) => setField("zoneY", e.target.value)} />
                  </label>
                </div>
                <button className="mqtt-btn k-ok" onClick={saveParams}>Uložit parametry</button>
              </div>
            )}
            {config && (
              <p className="profiles-note">
                offset x {config.x_offset} mm · invert_x {String(config.invert_x)} · {exclusions.length} vyloučených míst
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
