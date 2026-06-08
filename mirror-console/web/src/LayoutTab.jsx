import { useCallback, useEffect, useMemo, useState } from "react";
import MirrorGrid from "./MirrorGrid.jsx";
import ModulePickModal from "./ModulePickModal.jsx";
import WindowModal from "./WindowModal.jsx";
import LoadingOverlay from "./LoadingOverlay.jsx";
import { useToast } from "./Toast.jsx";

const HOUR_PX = 44;
const PREVIEW_TOPIC = "smartmirror/profile/preview";
const RELOAD_TOPIC = "smartmirror/profile/reload";
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
  const h = parseInt(p[1], 10), m = parseInt(p[0], 10);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
};

export default function LayoutTab({ profile, onWindowChange }) {
  const [store, setStore] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [registered, setRegistered] = useState([]);
  const [loadedByModule, setLoadedByModule] = useState({}); // module name → [ids in config.js]
  // What layout is being edited: a time window, the user's default layout, or
  // the always-on global layout. null = calendar overview.
  //   { kind: "window", key } | { kind: "default" } | { kind: "global" }
  const [target, setTarget] = useState(null);
  const [moving, setMoving] = useState(null); // instance id being moved
  const [addPos, setAddPos] = useState(null);
  const [showWindowModal, setShowWindowModal] = useState(false);
  const [editWindow, setEditWindow] = useState(null); // window key whose time is being edited
  const [status, setStatus] = useState(null);
  const [applying, setApplying] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Promise.all([
      fetch("/layout").then((r) => r.json()),
      fetch("/modules").then((r) => r.json()),
    ])
      .then(([st, mods]) => {
        setStore(st);
        setCatalog(mods.catalog || []);
        setRegistered(mods.registered_ids || []);
        setLoadedByModule(mods.loaded_by_module || {});
      })
      .catch(() => toast.error("Nepodařilo se načíst layout."));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const windows = useMemo(
    () => (store && store.windows && store.windows[profile]) || {},
    [store, profile]
  );

  // ── layout target read/write (window | per-user default | global) ──
  const readLayout = useCallback((st, t) => {
    if (!t || !st) return [];
    if (t.kind === "global") return st.globalLayout || [];
    if (t.kind === "default") return (st.defaults || {})[profile] || [];
    return st.windows?.[profile]?.[t.key]?.layout || [];
  }, [profile]);

  const writeLayout = useCallback((st, t, layout) => {
    if (t.kind === "global") { st.globalLayout = layout; return; }
    if (t.kind === "default") {
      st.defaults = st.defaults || {};
      st.defaults[profile] = layout;
      return;
    }
    st.windows[profile][t.key].layout = layout;
  }, [profile]);

  const targetTitle = (t) =>
    !t ? ""
    : t.kind === "global" ? "Globální rozložení (vždy zobrazené)"
    : t.kind === "default" ? `Výchozí rozložení — ${profile}`
    : t.key;

  // ── MQTT helpers (live preview / reload via the Node bridge) ──
  const publishMqtt = useCallback((topic, payload) =>
    fetch("/api/mqtt/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, payload }),
    }).catch(() => {}), []);
  const previewLayout = useCallback((layout) => publishMqtt(PREVIEW_TOPIC, { layout }), [publishMqtt]);
  const reloadMirror = useCallback(() => publishMqtt(RELOAD_TOPIC, ""), [publishMqtt]);

  // entering an editor → live preview that layout; leaving the tab → revert
  useEffect(() => {
    if (target) previewLayout(readLayout(store, target));
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { reloadMirror(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the parent whether an editor is open, so it can hide the
  // Rozložení/Fotky subtabs while editing a single layout.
  useEffect(() => {
    onWindowChange?.(!!target);
    return () => onWindowChange?.(false);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(async (next) => {
    setStore(next);
    setStatus("saving");
    try {
      const r = await fetch("/layout", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || `uložení ${r.status}`);
      setStatus("saved");
    } catch (e) {
      setStatus(null);
      toast.error(`Chyba uložení: ${e.message}`);
    }
  }, [toast]);

  const apply = useCallback(async (msg, layoutAfter) => {
    setApplying(true);
    setStatus(null);
    try {
      const r = await fetch("/layout/apply", { method: "POST" });
      const b = await r.json().catch(() => ({}));
      if (b.reload_needed) reloadMirror();
      // Re-send the preview so freshly-loaded modules get projected. After a
      // restart the mirror needs ~15s to come back + reconnect MQTT, so retry.
      if (layoutAfter) {
        if (b.restarted) {
          setTimeout(() => previewLayout(layoutAfter), 14000);
          setTimeout(() => previewLayout(layoutAfter), 22000);
        } else {
          previewLayout(layoutAfter);
        }
      }
      if (b.ok) toast.success(msg || (b.restarted ? "Aplikováno (restart zrcadla)." : "Aplikováno (živě)."));
      else toast.error(`Selhalo: ${b.output || ""}`);
    } catch (e) {
      toast.error(`Chyba: ${e.message}`);
    } finally {
      setApplying(false);
    }
  }, [reloadMirror, previewLayout, toast]);

  const idLabel = useCallback((id) => {
    const inst = (store?.instances || []).find((i) => i.id === id);
    if (!inst) return id;
    return (catalog.find((c) => c.type === inst.type) || {}).label || inst.type;
  }, [store, catalog]);

  const nextId = useCallback((type) => {
    const taken = new Set(registered);
    (store?.instances || []).forEach((i) => taken.add(i.id));
    const base = `${slug(type)}-${slug(profile)}`;
    let n = 1;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }, [registered, store, profile]);

  // An instance is "used" if referenced by the global layout, any user default,
  // or any time-window layout — drop the rest.
  const pruneInstances = (st) => {
    const used = new Set();
    (st.globalLayout || []).forEach((e) => used.add(e.id));
    Object.values(st.defaults || {}).forEach((l) =>
      (l || []).forEach((e) => used.add(e.id)));
    Object.values(st.windows || {}).forEach((ws) =>
      Object.values(ws).forEach((w) => (w.layout || []).forEach((e) => used.add(e.id))));
    st.instances = (st.instances || []).filter((i) => used.has(i.id));
  };

  const createWindow = ({ name, from, to }) => {
    const key = slug(name) || `okno-${Object.keys(windows).length + 1}`;
    const st = clone(store);
    st.windows = st.windows || {};
    st.windows[profile] = st.windows[profile] || {};
    st.windows[profile][key] = {
      from: cronFromTime(from), to: cronFromTime(to),
      label: `${from}–${to}`, layout: [],
    };
    persist(st);
    setShowWindowModal(false);
    setTarget({ kind: "window", key });
  };

  // Click on empty calendar time → add a one-hour window there and jump straight
  // into its layout editor.
  const addHourWindow = (hour) => {
    const h = Math.max(0, Math.min(23, hour));
    const label = `${String(h).padStart(2, "0")}:00–${String(h + 1).padStart(2, "0")}:00`;
    const st = clone(store);
    st.windows = st.windows || {};
    st.windows[profile] = st.windows[profile] || {};
    let key = `okno-${String(h).padStart(2, "0")}`;
    for (let n = 2; st.windows[profile][key]; n += 1) key = `okno-${String(h).padStart(2, "0")}-${n}`;
    st.windows[profile][key] = {
      from: cronFromTime(`${h}:0`), to: cronFromTime(`${h + 1}:0`),
      label, layout: [],
    };
    persist(st);
    setTarget({ kind: "window", key });
  };

  // Change the from/to time of an existing window (keeps its name/key + layout).
  const updateWindowTime = ({ from, to }) => {
    const st = clone(store);
    const w = st.windows?.[profile]?.[editWindow];
    if (!w) { setEditWindow(null); return; }
    w.from = cronFromTime(from);
    w.to = cronFromTime(to);
    w.label = `${from}–${to}`;
    persist(st);
    setEditWindow(null);
  };

  const onCalendarClick = (e) => {
    if (e.target.closest(".cal-event")) return; // existing window handles its own click
    const rect = e.currentTarget.getBoundingClientRect();
    addHourWindow(Math.floor((e.clientY - rect.top) / HOUR_PX));
  };

  const deleteWindow = (name) => {
    if (!window.confirm(`Smazat okno „${name}"?`)) return;
    const st = clone(store);
    delete st.windows[profile][name];
    pruneInstances(st);
    persist(st);
    if (target?.kind === "window" && target.key === name) { setTarget(null); reloadMirror(); }
  };

  // Empty the currently-edited default / global layout.
  const clearLayout = () => {
    if (!window.confirm("Vyčistit toto rozložení?")) return;
    const st = clone(store);
    writeLayout(st, target, []);
    pruneInstances(st);
    persist(st);
    previewLayout([]);
    setMoving(null);
  };

  // Add a module instance to the active layout (window / default / global).
  // If an instance of this type already exists in the store or in config.js,
  // reuse its id so no pm2 restart is needed.
  const addPlacement = ({ type, values }) => {
    const st = clone(store);
    st.instances = st.instances || [];

    // 1. Reuse existing store instance of the same type (e.g. placed elsewhere before)
    const existingInst = st.instances.find((i) => i.type === type);
    let id;
    if (existingInst) {
      id = existingInst.id;
    } else {
      // 2. Reuse an id already loaded by MagicMirror (manually in config.js)
      const catEntry = catalog.find((c) => c.type === type);
      const moduleName = catEntry?.module || type;
      const preloadedIds = (loadedByModule[moduleName] || []).filter(
        (pid) => !st.instances.some((i) => i.id === pid)
      );
      if (preloadedIds.length > 0) {
        // Module already in config.js — reference its existing id, no new instance needed
        id = preloadedIds[0];
      } else {
        // 3. Truly new instance — needs a one-time pm2 restart to register it
        id = nextId(type);
        st.instances.push({ id, type, values });
      }
    }

    const layoutAfter = [...readLayout(st, target), { id, position: addPos }];
    writeLayout(st, target, layoutAfter);
    setAddPos(null);
    (async () => { await persist(st); await apply("Modul přidán a načten.", layoutAfter); })();
  };

  // move an existing placement → keep the same id → mirror repositions LIVE
  const movePlacement = (id, position) => {
    const st = clone(store);
    const layout = readLayout(st, target).map((e) => (e.id === id ? { ...e, position } : e));
    writeLayout(st, target, layout);
    persist(st);
    previewLayout(layout);
  };

  const removePlacement = (id, pos) => {
    const st = clone(store);
    const layout = readLayout(st, target).filter((e) => !(e.id === id && e.position === pos));
    writeLayout(st, target, layout);
    pruneInstances(st);
    persist(st);
    previewLayout(layout);
    if (moving === id) setMoving(null);
  };

  const onCellClick = (pos) => {
    if (moving) { movePlacement(moving, pos); setMoving(null); }
    else setAddPos(pos);
  };

  if (!store) return <div className="monitor-empty">Načítám layout…</div>;

  const statusEl =
    status === "saving" ? <span className="save-dot">ukládám…</span>
    : status === "saved" ? <span className="save-dot ok">uloženo ✓</span>
    : status ? <span className="save-dot bad">{status}</span> : null;

  // ── layout editor (window / default / global) ──
  if (target) {
    const isWindow = target.kind === "window";
    const w = isWindow ? windows[target.key] : null;
    if (isWindow && !w) { setTarget(null); return null; }
    const layout = readLayout(store, target);
    return (
      <div className="layout-tab">
        <LoadingOverlay show={applying} message="Aplikuji (restart zrcadla)…" />
        <div className="wizard-head">
          <button className="mqtt-btn compact" onClick={() => { setTarget(null); setMoving(null); reloadMirror(); }}>← Kalendář</button>
          <strong>{isWindow ? target.key : targetTitle(target)}</strong>
          {isWindow ? (
            <button type="button" className="learn-progress time-edit-btn" title="Změnit čas okna"
              onClick={() => setEditWindow(target.key)}>
              {w.label || `${timeFromCron(w.from)}–${timeFromCron(w.to)}`} ✎
            </button>
          ) : (
            <span className="learn-progress">
              {target.kind === "global" ? "vždy zobrazené" : "když neběží žádné okno"}
            </span>
          )}
        </div>
        <MirrorGrid layout={layout} idLabel={idLabel} movingId={moving}
          onCellClick={onCellClick} onSelect={(id) => setMoving(moving === id ? null : id)}
          onRemove={removePlacement} />
        <div className="panel-actions detail-foot">
          {statusEl}
          {isWindow ? (
            <button className="mqtt-btn k-bad compact" onClick={() => deleteWindow(target.key)}>Smazat okno</button>
          ) : (
            <button className="mqtt-btn k-bad compact" disabled={!layout.length} onClick={clearLayout}>Vyčistit</button>
          )}
          <button className="mqtt-btn" disabled={applying} onClick={() => apply()}>Aplikovat na zrcadlo</button>
        </div>
        <p className="profiles-note">Posun: klikni na modul a pak na ＋ v cílové pozici — projeví se živě. Nový modul vyžaduje krátký restart.</p>
        {addPos && (
          <ModulePickModal catalog={catalog} position={addPos}
            onCancel={() => setAddPos(null)} onConfirm={addPlacement} />
        )}
        {editWindow && windows[editWindow] && (
          <WindowModal
            initial={{ name: editWindow,
              from: timeFromCron(windows[editWindow].from),
              to: timeFromCron(windows[editWindow].to) }}
            onCancel={() => setEditWindow(null)} onConfirm={updateWindowTime} />
        )}
      </div>
    );
  }

  // ── calendar (day column) ──
  const entries = Object.entries(windows);
  const defaultCount = (store.defaults?.[profile] || []).length;
  const globalCount = (store.globalLayout || []).length;
  return (
    <div className="layout-tab">
      <LoadingOverlay show={applying} message="Aplikuji (restart zrcadla)…" />
      <div className="cal-bar">
        <button className="mqtt-btn k-ok" onClick={() => setShowWindowModal(true)}>＋ Přidat časové okno</button>
        <button className="mqtt-btn compact" onClick={() => setTarget({ kind: "default" })}
          title="Co se zobrazí tomuto profilu, když neběží žádné časové okno">
          Výchozí ({defaultCount})
        </button>
        <button className="mqtt-btn compact" onClick={() => setTarget({ kind: "global" })}
          title="Co se zobrazí vždy, nezávisle na profilu i čase">
          Globální ({globalCount})
        </button>
        {statusEl}
        <button className="mqtt-btn" disabled={applying} onClick={() => apply()}>Aplikovat na zrcadlo</button>
      </div>

      <div className="cal-scroll">
        <div className="cal cal-clickable" style={{ height: 24 * HOUR_PX }} onClick={onCalendarClick}>
          {Array.from({ length: 25 }, (_, h) => (
            <div key={h} className="cal-line" style={{ top: h * HOUR_PX }}>
              <span className="cal-label">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
          <div className="cal-events">
            {entries.map(([name, w]) => {
              const top = (minsFromCron(w.from) / 60) * HOUR_PX;
              const height = Math.max(26, ((minsFromCron(w.to) - minsFromCron(w.from)) / 60) * HOUR_PX);
              return (
                <button key={name} className="cal-event" style={{ top, height }} onClick={() => setTarget({ kind: "window", key: name })}>
                  <span className="cal-event-name">{name}</span>
                  <span className="cal-event-time">
                    <span className="time-edit" title="Změnit čas okna"
                      onClick={(e) => { e.stopPropagation(); setEditWindow(name); }}>
                      {timeFromCron(w.from)}–{timeFromCron(w.to)} ✎
                    </span>
                    {" · "}{(w.layout || []).length} mod.
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {entries.length === 0 && (
        <div className="monitor-empty">Žádná časová okna — klikni do kalendáře na prázdný čas nebo použij tlačítko nahoře. „Výchozí" a „Globální" určují, co se zobrazí mimo okna.</div>
      )}

      {showWindowModal && (
        <WindowModal onCancel={() => setShowWindowModal(false)} onConfirm={createWindow} />
      )}
      {editWindow && windows[editWindow] && (
        <WindowModal
          initial={{ name: editWindow,
            from: timeFromCron(windows[editWindow].from),
            to: timeFromCron(windows[editWindow].to) }}
          onCancel={() => setEditWindow(null)} onConfirm={updateWindowTime} />
      )}
    </div>
  );
}
