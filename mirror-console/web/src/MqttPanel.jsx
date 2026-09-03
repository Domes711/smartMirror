import { useCallback, useEffect, useRef, useState } from "react";

// Static MQTT groups (radar, gestures, control)
const STATIC_GROUPS = [
  {
    title: "Přítomnost (radar)",
    topic: "smartmirror/radar/presence",
    buttons: [
      { label: "Detekován pohyb", payload: "present", kind: "ok" },
      { label: "Prostor prázdný", payload: "absent", kind: "muted" },
    ],
  },
  {
    title: "Gesto (počet prstů)",
    topic: "smartmirror/camera/gesture",
    buttons: [
      ...[0, 1, 2, 3, 4, 5].map((n) => ({
        label: String(n),
        payload: { gesture: "finger_count", count: n },
        compact: true,
      })),
      { label: "Žádné gesto", payload: { gesture: null }, kind: "muted" },
    ],
  },
  {
    title: "Řízení",
    topic: "smartmirror/control/reset",
    buttons: [{ label: "Reset stavu", payload: "", kind: "warn" }],
  },
];

const fmtPayload = (p) => (typeof p === "string" ? p : JSON.stringify(p));
const time = (ts) => new Date(ts).toLocaleTimeString();

export default function MqttPanel() {
  const [status, setStatus] = useState(null); // {connected}
  const [log, setLog] = useState([]); // {ts, dir, topic, payload}
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState([]); // user profiles from API
  const [selectedProfile, setSelectedProfile] = useState("monitor"); // "monitor" or profile name
  const esRef = useRef(null);

  // Load user profiles
  useEffect(() => {
    let alive = true;
    fetch("/profiles")
      .then((r) => r.json())
      .then((data) => {
        if (alive && data.profiles) {
          // Filter out "default" profile
          const userProfiles = data.profiles.filter((p) => p.name !== "default");
          setProfiles(userProfiles);
          // Set first profile as default if available
          if (userProfiles.length > 0) {
            setSelectedProfile(userProfiles[0].name);
          }
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // connection status
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/mqtt/status")
        .then((r) => r.json())
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus({ connected: false }));
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // live monitor (SSE) of all smartmirror/# traffic
  useEffect(() => {
    const es = new EventSource("/api/mqtt/stream");
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.system) return; // ignore the initial handshake line
        setLog((l) => [{ ...m, dir: "in" }, ...l].slice(0, 100));
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {}; // EventSource auto-reconnects
    return () => es.close();
  }, []);

  const publish = useCallback(async (topic, payload) => {
    setBusy(true);
    try {
      const res = await fetch("/api/mqtt/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `publish ${res.status}`);
      setLog((l) =>
        [
          { ts: Date.now(), dir: "out", topic, payload: fmtPayload(payload) },
          ...l,
        ].slice(0, 100)
      );
    } catch (e) {
      setLog((l) =>
        [
          { ts: Date.now(), dir: "err", topic, payload: e.message },
          ...l,
        ].slice(0, 100)
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const connected = status?.connected;

  // Generate buttons based on selected profile
  const getDynamicButtons = () => {
    if (selectedProfile === "monitor") {
      return {
        topic: "smartmirror/display/control",
        buttons: [
          { label: "Probudit / Stand-by", payload: { command: "toggle" }, kind: "ok" },
          { label: "Jas: 100%", payload: { command: "brightness", value: 100 }, compact: true },
          { label: "Jas: 75%", payload: { command: "brightness", value: 75 }, compact: true },
          { label: "Jas: 50%", payload: { command: "brightness", value: 50 }, compact: true },
          { label: "Jas: 25%", payload: { command: "brightness", value: 25 }, compact: true },
          { label: "Jas: 0%", payload: { command: "brightness", value: 0 }, compact: true },
        ],
      };
    } else {
      // User profile selected
      return {
        topic: "smartmirror/camera/recognition",
        buttons: [
          { label: `Rozpoznán: ${selectedProfile}`, payload: { user: selectedProfile }, kind: "ok" },
          { label: "Neznámý / nikdo", payload: { user: null }, kind: "muted" },
        ],
      };
    }
  };

  const dynamicSection = getDynamicButtons();

  return (
    <div className="panel">
      <div className="panel-head">
        <span className={"pill " + (connected ? "pill-live" : "pill-bad")}>
          ● {connected ? "MQTT připojeno" : "MQTT odpojeno"}
        </span>
      </div>

      <div className="mqtt-groups">
        {/* Static groups */}
        {STATIC_GROUPS.map((g) => (
          <section key={g.topic} className="card mqtt-group">
            <div className="mqtt-group-head">
              <h3>{g.title}</h3>
              <code className="topic">{g.topic}</code>
            </div>
            <div className="mqtt-btns">
              {g.buttons.map((b, i) => (
                <button
                  key={i}
                  className={
                    "mqtt-btn" +
                    (b.kind ? ` k-${b.kind}` : "") +
                    (b.compact ? " compact" : "")
                  }
                  disabled={busy}
                  onClick={() => publish(g.topic, b.payload)}
                  title={fmtPayload(b.payload)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </section>
        ))}

        {/* Dynamic section: User recognition or Monitor control */}
        <section className="card mqtt-group">
          <div className="mqtt-group-head">
            <h3>Rozpoznání / Ovládání</h3>
            <code className="topic">{dynamicSection.topic}</code>
          </div>
          <div style={{ padding: "0 1rem 0.5rem" }}>
            <select
              value={selectedProfile}
              onChange={(e) => setSelectedProfile(e.target.value)}
              style={{
                width: "100%",
                padding: "0.5rem",
                fontSize: "0.95rem",
                borderRadius: "4px",
                border: "1px solid #555",
                background: "#2a2a2a",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              <option value="monitor">🖥️ Monitor</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  👤 {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mqtt-btns">
            {dynamicSection.buttons.map((b, i) => (
              <button
                key={i}
                className={
                  "mqtt-btn" +
                  (b.kind ? ` k-${b.kind}` : "") +
                  (b.compact ? " compact" : "")
                }
                disabled={busy}
                onClick={() => publish(dynamicSection.topic, b.payload)}
                title={fmtPayload(b.payload)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="card monitor">
        <div className="monitor-head">
          <h3>Provoz na sběrnici</h3>
          <button className="mqtt-btn compact" onClick={() => setLog([])}>
            Vyčistit
          </button>
        </div>
        <div className="monitor-log">
          {log.length === 0 ? (
            <div className="monitor-empty">Zatím žádné zprávy…</div>
          ) : (
            log.map((m, i) => (
              <div key={i} className={"logline dir-" + m.dir}>
                <span className="t">{time(m.ts)}</span>
                <span className="d">
                  {m.dir === "out" ? "↑" : m.dir === "err" ? "✕" : "↓"}
                </span>
                <span className="tp">{m.topic}</span>
                <span className="pl">{m.payload}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
