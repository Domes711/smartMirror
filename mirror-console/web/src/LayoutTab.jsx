import { useCallback, useEffect, useMemo, useState } from "react";
import MirrorGrid from "./MirrorGrid.jsx";
import ModulePickModal from "./ModulePickModal.jsx";
import LoadingOverlay from "./LoadingOverlay.jsx";

const clone = (o) => JSON.parse(JSON.stringify(o));
const cronFromTime = (t) => {
  const [h, m] = (t || "0:0").split(":").map((n) => parseInt(n, 10) || 0);
  return `${m} ${h} * * *`;
};
const timeFromCron = (c) => {
  const p = (c || "").split(" ");
  const h = (p[1] || "0").padStart(2, "0");
  const m = (p[0] || "0").padStart(2, "0");
  return `${h}:${m}`;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function LayoutTab({ profile }) {
  const [store, setStore] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [registered, setRegistered] = useState([]);
  const [selected, setSelected] = useState(null); // window name
  const [addPos, setAddPos] = useState(null); // position for the pick modal
  const [newWin, setNewWin] = useState({ name: "", from: "09:00", to: "12:00" });
  const [busy, setBusy] = useState(null); // overlay msg
  const [msg, setMsg] = useState(null);

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
      .catch(() => setMsg("Nepodařilo se načíst layout."));
  }, []);

  const windows = useMemo(
    () => (store && store.windows && store.windows[profile]) || {},
    [store, profile]
  );

  const idLabel = useCallback(
    (id) => {
      const inst = (store?.instances || []).find((i) => i.id === id);
      if (!inst) return id;
      const cat = catalog.find((c) => c.type === inst.type);
      return cat ? cat.label : inst.type;
    },
    [store, catalog]
  );

  const takenIds = useMemo(() => {
    const s = new Set(registered);
    (store?.instances || []).forEach((i) => s.add(i.id));
    return s;
  }, [registered, store]);

  const nextId = useCallback(
    (type) => {
      const base = `${slug(type)}-${slug(profile)}`;
      let n = 1;
      while (takenIds.has(`${base}-${n}`)) n += 1;
      return `${base}-${n}`;
    },
    [profile, takenIds]
  );

  const addWindow = () => {
    const name = slug(newWin.name) || `okno-${Object.keys(windows).length + 1}`;
    const st = clone(store);
    st.windows = st.windows || {};
    st.windows[profile] = st.windows[profile] || {};
    st.windows[profile][name] = {
      from: cronFromTime(newWin.from),
      to: cronFromTime(newWin.to),
      label: `${newWin.from}–${newWin.to}`,
      layout: [],
    };
    setStore(st);
    setSelected(name);
    setNewWin({ name: "", from: "09:00", to: "12:00" });
  };

  const deleteWindow = (name) => {
    if (!window.confirm(`Smazat okno „${name}"?`)) return;
    const st = clone(store);
    delete st.windows[profile][name];
    setStore(st);
    if (selected === name) setSelected(null);
  };

  const addPlacement = ({ type, values }) => {
    const st = clone(store);
    const id = nextId(type);
    st.instances = st.instances || [];
    st.instances.push({ id, type, values });
    st.windows[profile][selected].layout.push({ id, position: addPos });
    setStore(st);
    setAddPos(null);
  };

  const removePlacement = (id, pos) => {
    const st = clone(store);
    const w = st.windows[profile][selected];
    w.layout = w.layout.filter((e) => !(e.id === id && e.position === pos));
    setStore(st);
  };

  const save = async () => {
    setBusy("Ukládám…");
    setMsg(null);
    try {
      // prune console instances no longer referenced by any layout
      const st = clone(store);
      const used = new Set();
      Object.values(st.windows || {}).forEach((wins) =>
        Object.values(wins).forEach((w) => (w.layout || []).forEach((e) => used.add(e.id)))
      );
      (st.globalLayout || []).forEach((e) => used.add(e.id));
      st.instances = (st.instances || []).filter((i) => used.has(i.id));
      const r = await fetch("/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(st),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || `uložení ${r.status}`);
      setStore(st);
      setMsg("Uloženo. Klikni Aplikovat na zrcadlo pro projevení.");
    } catch (e) {
      setMsg(`Chyba: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy("Aplikuji a restartuji zrcadlo…");
    setMsg(null);
    try {
      const r = await fetch("/layout/apply", { method: "POST" });
      const b = await r.json().catch(() => ({}));
      setMsg(b.ok ? "Aplikováno — zrcadlo se restartuje." : `Restart selhal: ${b.output || ""}`);
    } catch (e) {
      setMsg(`Chyba: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  if (!store) return <div className="monitor-empty">Načítám layout…</div>;

  const win = selected && windows[selected];

  return (
    <div className="layout-tab">
      <LoadingOverlay show={!!busy} message={busy} />

      {!selected ? (
        <>
          <div className="win-list">
            {Object.keys(windows).length === 0 ? (
              <div className="monitor-empty">Žádná časová okna. Přidej první níže.</div>
            ) : (
              Object.entries(windows).map(([name, w]) => (
                <div key={name} className="card win-row">
                  <button className="win-open" onClick={() => setSelected(name)}>
                    <strong>{name}</strong>
                    <span className="profile-meta">
                      {w.label || `${timeFromCron(w.from)}–${timeFromCron(w.to)}`} ·{" "}
                      {(w.layout || []).length} modulů
                    </span>
                  </button>
                  <button className="mqtt-btn k-bad compact" onClick={() => deleteWindow(name)}>
                    Smazat
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="card new-win">
            <strong>＋ Přidat časové okno</strong>
            <div className="new-win-row">
              <label className="field">
                <span>Název</span>
                <input
                  value={newWin.name}
                  placeholder="ráno"
                  onChange={(e) => setNewWin((s) => ({ ...s, name: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Od</span>
                <input type="time" value={newWin.from}
                  onChange={(e) => setNewWin((s) => ({ ...s, from: e.target.value }))} />
              </label>
              <label className="field">
                <span>Do</span>
                <input type="time" value={newWin.to}
                  onChange={(e) => setNewWin((s) => ({ ...s, to: e.target.value }))} />
              </label>
              <button className="mqtt-btn k-ok" onClick={addWindow}>Přidat</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="wizard-head">
            <button className="mqtt-btn compact" onClick={() => setSelected(null)}>← Okna</button>
            <strong>{selected}</strong>
            <span className="learn-progress">
              {win.label || `${timeFromCron(win.from)}–${timeFromCron(win.to)}`}
            </span>
          </div>
          <MirrorGrid
            layout={win.layout || []}
            idLabel={idLabel}
            onAdd={(pos) => setAddPos(pos)}
            onRemove={removePlacement}
          />
        </>
      )}

      <div className="panel-actions detail-foot">
        <button className="mqtt-btn k-ok" onClick={save}>Uložit</button>
        <button className="mqtt-btn" onClick={apply}>Aplikovat na zrcadlo</button>
      </div>
      {msg && <div className="learn-msg">{msg}</div>}

      {addPos && (
        <ModulePickModal
          catalog={catalog}
          position={addPos}
          onCancel={() => setAddPos(null)}
          onConfirm={addPlacement}
        />
      )}
    </div>
  );
}
