import { useCallback, useEffect, useMemo, useState } from "react";
import MirrorGrid from "./MirrorGrid.jsx";
import ModulePickModal from "./ModulePickModal.jsx";
import WindowModal from "./WindowModal.jsx";
import LoadingOverlay from "./LoadingOverlay.jsx";

const HOUR_PX = 44;
const clone = (o) => JSON.parse(JSON.stringify(o));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const cronFromTime = (t) => {
  const [h, m] = (t || "0:0").split(":").map((n) => parseInt(n, 10) || 0);
  return `${m} ${h} * * *`;
};
const timeFromCron = (c) => {
  const p = (c || "").split(" ");
  return `${(p[1] || "0").padStart(2, "0")}:${(p[0] || "0").padStart(2, "0")}`;
};
const minsFromCron = (c) => {
  const p = (c || "").split(" ");
  const h = parseInt(p[1], 10);
  const m = parseInt(p[0], 10);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
};

export default function LayoutTab({ profile }) {
  const [store, setStore] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [registered, setRegistered] = useState([]);
  const [selected, setSelected] = useState(null); // window name → editor
  const [addPos, setAddPos] = useState(null); // module pick modal
  const [showWindowModal, setShowWindowModal] = useState(false);
  const [status, setStatus] = useState(null); // "saving" | "saved" | error string
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/layout").then((r) => r.json()),
      fetch("/modules").then((r) => r.json()),
    ])
      .then(([st, mods]) => {
        setStore(st);
        setCatalog(mods.catalog || []);
        setRegistered(mods.registered_ids || []);
      })
      .catch(() => setStatus("Nepodařilo se načíst layout."));
  }, []);

  const windows = useMemo(
    () => (store && store.windows && store.windows[profile]) || {},
    [store, profile]
  );

  // auto-save: every mutation persists immediately so state survives refresh/back
  const persist = useCallback(async (next) => {
    setStore(next);
    setStatus("saving");
    try {
      const r = await fetch("/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || `uložení ${r.status}`);
      setStatus("saved");
    } catch (e) {
      setStatus(`Chyba uložení: ${e.message}`);
    }
  }, []);

  const idLabel = useCallback(
    (id) => {
      const inst = (store?.instances || []).find((i) => i.id === id);
      if (!inst) return id;
      return (catalog.find((c) => c.type === inst.type) || {}).label || inst.type;
    },
    [store, catalog]
  );

  const nextId = useCallback(
    (type) => {
      const taken = new Set(registered);
      (store?.instances || []).forEach((i) => taken.add(i.id));
      const base = `${slug(type)}-${slug(profile)}`;
      let n = 1;
      while (taken.has(`${base}-${n}`)) n += 1;
      return `${base}-${n}`;
    },
    [registered, store, profile]
  );

  const createWindow = ({ name, from, to }) => {
    const key = slug(name) || `okno-${Object.keys(windows).length + 1}`;
    const st = clone(store);
    st.windows = st.windows || {};
    st.windows[profile] = st.windows[profile] || {};
    st.windows[profile][key] = {
      from: cronFromTime(from),
      to: cronFromTime(to),
      label: `${from}–${to}`,
      layout: [],
    };
    persist(st);
    setShowWindowModal(false);
    setSelected(key); // straight into the module editor
  };

  const deleteWindow = (name) => {
    if (!window.confirm(`Smazat okno „${name}"?`)) return;
    const st = clone(store);
    delete st.windows[profile][name];
    // prune now-unreferenced console instances
    const used = new Set();
    Object.values(st.windows || {}).forEach((ws) =>
      Object.values(ws).forEach((w) => (w.layout || []).forEach((e) => used.add(e.id)))
    );
    st.instances = (st.instances || []).filter((i) => used.has(i.id));
    persist(st);
    if (selected === name) setSelected(null);
  };

  const addPlacement = ({ type, values }) => {
    const st = clone(store);
    const id = nextId(type);
    st.instances = st.instances || [];
    st.instances.push({ id, type, values });
    st.windows[profile][selected].layout.push({ id, position: addPos });
    persist(st);
    setAddPos(null);
  };

  const removePlacement = (id, pos) => {
    const st = clone(store);
    const w = st.windows[profile][selected];
    w.layout = w.layout.filter((e) => !(e.id === id && e.position === pos));
    const used = new Set();
    Object.values(st.windows || {}).forEach((ws) =>
      Object.values(ws).forEach((win) => (win.layout || []).forEach((e) => used.add(e.id)))
    );
    st.instances = (st.instances || []).filter((i) => used.has(i.id));
    persist(st);
  };

  const apply = async () => {
    setApplying(true);
    try {
      const r = await fetch("/layout/apply", { method: "POST" });
      const b = await r.json().catch(() => ({}));
      setStatus(b.ok ? "Aplikováno — zrcadlo se restartuje." : `Restart selhal: ${b.output || ""}`);
    } catch (e) {
      setStatus(`Chyba: ${e.message}`);
    } finally {
      setApplying(false);
    }
  };

  if (!store) return <div className="monitor-empty">Načítám layout…</div>;

  const statusEl =
    status === "saving" ? <span className="save-dot">ukládám…</span>
    : status === "saved" ? <span className="save-dot ok">uloženo ✓</span>
    : status ? <span className="save-dot bad">{status}</span>
    : null;

  // ── editor of a single window ──
  if (selected) {
    const w = windows[selected];
    if (!w) { setSelected(null); return null; }
    return (
      <div className="layout-tab">
        <LoadingOverlay show={applying} message="Aplikuji a restartuji zrcadlo…" />
        <div className="wizard-head">
          <button className="mqtt-btn compact" onClick={() => setSelected(null)}>← Kalendář</button>
          <strong>{selected}</strong>
          <span className="learn-progress">{w.label || `${timeFromCron(w.from)}–${timeFromCron(w.to)}`}</span>
        </div>
        <MirrorGrid layout={w.layout || []} idLabel={idLabel}
          onAdd={(pos) => setAddPos(pos)} onRemove={removePlacement} />
        <div className="panel-actions detail-foot">
          {statusEl}
          <button className="mqtt-btn k-bad compact" onClick={() => deleteWindow(selected)}>Smazat okno</button>
          <button className="mqtt-btn" disabled={applying} onClick={apply}>Aplikovat na zrcadlo</button>
        </div>
        {addPos && (
          <ModulePickModal catalog={catalog} position={addPos}
            onCancel={() => setAddPos(null)} onConfirm={addPlacement} />
        )}
      </div>
    );
  }

  // ── calendar (day column) ──
  const entries = Object.entries(windows);
  return (
    <div className="layout-tab">
      <LoadingOverlay show={applying} message="Aplikuji a restartuji zrcadlo…" />
      <div className="cal-bar">
        <button className="mqtt-btn k-ok" onClick={() => setShowWindowModal(true)}>＋ Přidat časové okno</button>
        {statusEl}
        <button className="mqtt-btn" disabled={applying} onClick={apply}>Aplikovat na zrcadlo</button>
      </div>

      <div className="cal-scroll">
        <div className="cal" style={{ height: 24 * HOUR_PX }}>
          {Array.from({ length: 25 }, (_, h) => (
            <div key={h} className="cal-line" style={{ top: h * HOUR_PX }}>
              <span className="cal-label">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
          <div className="cal-events">
            {entries.length === 0 ? null : entries.map(([name, w]) => {
              const top = (minsFromCron(w.from) / 60) * HOUR_PX;
              const height = Math.max(26, ((minsFromCron(w.to) - minsFromCron(w.from)) / 60) * HOUR_PX);
              return (
                <button key={name} className="cal-event" style={{ top, height }}
                  onClick={() => setSelected(name)}>
                  <span className="cal-event-name">{name}</span>
                  <span className="cal-event-time">
                    {timeFromCron(w.from)}–{timeFromCron(w.to)} · {(w.layout || []).length} mod.
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {entries.length === 0 && (
        <div className="monitor-empty">Žádná časová okna — přidej první tlačítkem nahoře.</div>
      )}

      {showWindowModal && (
        <WindowModal onCancel={() => setShowWindowModal(false)} onConfirm={createWindow} />
      )}
    </div>
  );
}
