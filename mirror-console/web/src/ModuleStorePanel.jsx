import { useCallback, useEffect, useRef, useState } from "react";
import ModuleDetail from "./ModuleDetail.jsx";

const TABS = [
  { id: "own",       icon: "🧩", label: "Moje" },
  { id: "installed", icon: "✅", label: "Instalované" },
  { id: "browse",    icon: "🔍", label: "Prohledat" },
];

export default function ModuleStorePanel() {
  const [data, setData]         = useState(null);
  const [error, setError]       = useState(null);
  const [tab, setTab]           = useState("own");
  const [query, setQuery]       = useState("");
  const [selected, setSelected] = useState(null);

  // Scroll restoration: save position before entering detail, restore after back.
  const savedScroll   = useRef(0);
  const shouldRestore = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/store/catalog");
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || `catalog ${r.status}`);
      setData(b);
      setError(null);
    } catch (e) {
      setError(e.message);
      setData({ community: [], own: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Restore scroll after data re-loads following a back navigation.
  useEffect(() => {
    if (shouldRestore.current && data !== null) {
      shouldRestore.current = false;
      requestAnimationFrame(() => window.scrollTo(0, savedScroll.current));
    }
  }, [data]);

  const switchTab = (id) => { setTab(id); setQuery(""); };

  const handlePick = (m) => {
    savedScroll.current = window.scrollY;
    setSelected(m);
  };

  const handleBack = () => {
    shouldRestore.current = true;
    setSelected(null);
    load();
  };

  if (selected) {
    return <ModuleDetail module={selected} onBack={handleBack} />;
  }

  const own       = data?.own || [];
  const installed = (data?.community || []).filter(m => m.installed);
  const q         = query.trim().toLowerCase();
  const browse    = (data?.community || []).filter(m =>
    !m.installed &&
    (!q ||
      m.name.toLowerCase().includes(q) ||
      (m.description || "").toLowerCase().includes(q) ||
      (m.category || "").toLowerCase().includes(q))
  );
  const loading = data === null;
  const counts  = {
    own:       own.length,
    installed: installed.length,
    browse:    (data?.community || []).filter(m => !m.installed).length,
  };

  return (
    <div className="panel">
      <div className="panel-head">
        {error
          ? <span className="pill pill-bad">● {error}</span>
          : <span className="pill">{loading ? "● načítám katalog…" : `● ${counts.browse} dostupných`}</span>}
      </div>

      {data?.error && (
        <p className="store-note store-warn">
          Internetový katalog se nepodařilo načíst: {data.error}
        </p>
      )}

      <div className="tabs store-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={"tab store-tab" + (tab === t.id ? " active" : "")}
            onClick={() => switchTab(t.id)}
          >
            <span className="store-tab-icon">{t.icon}</span>
            <span className="store-tab-label">{t.label}</span>
            {!loading && <span className="store-tab-count">{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card status-card">
          <div className="status-icon">🧩</div>
          <h2>Načítám…</h2>
        </div>
      ) : (
        <>
          {tab === "own" && (
            <ModuleList modules={own} empty="Zatím žádné vlastní moduly." onPick={handlePick} />
          )}
          {tab === "installed" && (
            <ModuleList modules={installed} empty="Žádné nainstalované moduly." onPick={handlePick} />
          )}
          {tab === "browse" && (
            <>
              <div className="panel-actions">
                <input
                  className="store-search"
                  type="search"
                  placeholder="Hledat modul…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              <ModuleList
                modules={browse}
                empty={q ? "Nic nenalezeno." : "Začni psát pro vyhledání…"}
                onPick={handlePick}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function ModuleList({ modules, empty, onPick }) {
  if (modules.length === 0) return <p className="store-note">{empty}</p>;
  return (
    <div className="store-list">
      {modules.map(m => (
        <ModuleCard key={m.id} module={m} onClick={() => onPick(m)} />
      ))}
    </div>
  );
}

function ModuleCard({ module: m, onClick }) {
  return (
    <button className="card store-card clickable" onClick={onClick}>
      <div className="store-thumb">
        {m.image
          ? <img src={m.image} alt="" loading="lazy" />
          : <span className="store-thumb-ph">🪞</span>}
      </div>
      <div className="store-card-body">
        <div className="store-card-top">
          <h4>{m.name}</h4>
        </div>
        {m.description && <p className="store-desc">{m.description}</p>}
        <div className="store-meta">
          {m.maintainer && <span>👤 {m.maintainer}</span>}
          {typeof m.stars === "number" && <span>★ {m.stars}</span>}
          {m.category && <span className="store-cat">{m.category}</span>}
        </div>
      </div>
    </button>
  );
}
