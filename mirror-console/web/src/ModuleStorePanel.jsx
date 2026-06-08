import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ModuleDetail from "./ModuleDetail.jsx";
import ModuleCreator from "./ModuleCreator.jsx";

const TABS = [
  { id: "own",       label: "Moje" },
  { id: "installed", label: "Instalované" },
  { id: "browse",    label: "Prohledat" },
];

export default function ModuleStorePanel() {
  const [data, setData]         = useState(null);
  const [error, setError]       = useState(null);
  const [tab, setTab]           = useState("own");
  const [query, setQuery]       = useState("");
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);

  // Scroll restoration: save position before entering detail, restore after back.
  // Only the list scrolls (the page is locked to the viewport), so we track the
  // list container's scrollTop rather than the window.
  const savedScroll   = useRef(0);
  const shouldRestore = useRef(false);
  const listRef       = useRef(null);

  // Lock the page to the viewport for the list and the module detail, so only
  // the inner scroll region moves while the topbar / controls / detail header
  // stay put. The AI creator manages its own full-screen layout, so leave it
  // with the normal page scroll.
  useLayoutEffect(() => {
    const app = document.querySelector(".app");
    if (!app) return;
    app.classList.toggle("app-locked", !creating);
    return () => app.classList.remove("app-locked");
  }, [creating]);

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
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = savedScroll.current;
      });
    }
  }, [data]);

  const switchTab = (id) => {
    setTab(id);
    setQuery("");
    // Always start a freshly opened section at the top.
    if (listRef.current) listRef.current.scrollTop = 0;
    requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = 0; });
  };

  const handlePick = (m) => {
    savedScroll.current = listRef.current?.scrollTop || 0;
    setSelected(m);
  };

  const handleBack = () => {
    shouldRestore.current = true;
    setSelected(null);
    load();
  };

  if (creating) {
    return <ModuleCreator onBack={() => { setCreating(false); load(); }} />;
  }

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
    <div className="panel store-panel">
      {/* Pinned controls: status pill + tab switcher + per-tab action row.
          Stays put while only the module list below scrolls. */}
      <div className="store-head">
        <div className="store-topbar">
          <button className="pill pill-btn" onClick={() => setCreating(true)}>
            ＋ Vytvořit modul
          </button>
          {error
            ? <span className="pill pill-bad">● {error}</span>
            : <span className="pill">{loading ? "● načítám katalog…" : `● ${counts.browse} dostupných`}</span>}
        </div>

        {data?.error && (
          <p className="store-note store-warn">
            Internetový katalog se nepodařilo načíst: {data.error}
          </p>
        )}

        <div className="subnav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={"subnav-item" + (tab === t.id ? " active" : "")}
              onClick={() => switchTab(t.id)}
            >
              {t.label}
              {!loading && <span className="store-tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </div>

        {!loading && tab === "browse" && (
          <div className="panel-actions">
            <input
              className="store-search"
              type="search"
              placeholder="Hledat modul…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="card status-card">
          <div className="status-icon">🧩</div>
          <h2>Načítám…</h2>
        </div>
      ) : (
        <div className="store-scroll" ref={listRef}>
          {tab === "own" && (
            <ModuleList
              modules={own}
              empty="Zatím žádné vlastní moduly."
              onPick={handlePick}
            />
          )}
          {tab === "installed" && (
            <ModuleList modules={installed} empty="Žádné nainstalované moduly." onPick={handlePick} />
          )}
          {tab === "browse" && (
            <ModuleList
              modules={browse}
              empty={q ? "Nic nenalezeno." : "Začni psát pro vyhledání…"}
              onPick={handlePick}
            />
          )}
        </div>
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
  const cat = m.catalog;
  // Prefer official catalog image; fall back to first mm-store screenshot.
  const image = m.image || cat?.screenshots?.[0] || null;
  const originName = cat?.name?.origin || m.name;
  const localName = cat?.name?.cs || cat?.name?.en || "";
  const desc = cat?.description?.cs || cat?.description?.en || m.description;
  const tags = cat?.tags?.slice(0, 3) || [];

  return (
    <button className="card store-card clickable" onClick={onClick}>
      <div className="store-thumb">
        {image
          ? <img src={image} alt="" loading="lazy" />
          : <span className="store-thumb-ph">🪞</span>}
      </div>
      <div className="store-card-body">
        <div className="store-card-top">
          <h4>{originName}</h4>
        </div>
        {localName && localName !== originName && (
          <p className="store-card-subtitle">{localName}</p>
        )}
        {desc && <p className="store-desc">{desc}</p>}
        {tags.length > 0 ? (
          <div className="store-card-tags">
            {tags.map(tag => <span key={tag} className="store-tag">{tag}</span>)}
          </div>
        ) : (
          <div className="store-meta">
            {m.maintainer && <span>👤 {m.maintainer}</span>}
            {typeof m.stars === "number" && <span>★ {m.stars}</span>}
            {m.category && <span className="store-cat">{m.category}</span>}
          </div>
        )}
      </div>
    </button>
  );
}
