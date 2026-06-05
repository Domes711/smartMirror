import { useCallback, useEffect, useState } from "react";
import ModuleDetail from "./ModuleDetail.jsx";

// Module Store: browse the MagicMirror community catalog (fetched from the
// internet) plus the modules developed in this repo, install / uninstall them.
// Overview list of stacked cards → click a card to open its app-store detail.
export default function ModuleStorePanel() {
  const [data, setData] = useState(null); // { community, own, error } | null=loading
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // module object

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

  useEffect(() => {
    load();
  }, [load]);

  if (selected) {
    return (
      <ModuleDetail
        module={selected}
        onBack={() => {
          setSelected(null);
          load(); // refresh installed flags after install/uninstall
        }}
      />
    );
  }

  const q = query.trim().toLowerCase();
  const match = (m) =>
    !q ||
    m.name.toLowerCase().includes(q) ||
    (m.description || "").toLowerCase().includes(q) ||
    (m.category || "").toLowerCase().includes(q);

  const own = (data?.own || []).filter(match);
  const community = (data?.community || []).filter(match);

  return (
    <div className="panel">
      <div className="panel-head">
        {error ? (
          <span className="pill pill-bad">● {error}</span>
        ) : (
          <span className="pill">
            {data === null
              ? "● načítám katalog…"
              : `● ${(data.community || []).length} z internetu · ${(data.own || []).length} mých`}
          </span>
        )}
      </div>

      {data?.error && (
        <p className="store-note store-warn">
          Internetový katalog se nepodařilo načíst: {data.error}
        </p>
      )}

      <div className="panel-actions">
        <input
          className="store-search"
          type="search"
          placeholder="Hledat modul…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {data === null ? (
        <div className="card status-card">
          <div className="status-icon">🧩</div>
          <h2>Načítám…</h2>
        </div>
      ) : (
        <>
          <Section
            title="Moje moduly"
            modules={own}
            empty="Žádné vlastní moduly."
            onPick={setSelected}
          />
          <Section
            title="Z internetu"
            modules={community}
            empty="Nic nenalezeno."
            onPick={setSelected}
          />
        </>
      )}
    </div>
  );
}

function Section({ title, modules, empty, onPick }) {
  return (
    <section className="store-section">
      <h3 className="store-section-title">
        {title} <span className="store-count">{modules.length}</span>
      </h3>
      {modules.length === 0 ? (
        <p className="store-note">{empty}</p>
      ) : (
        <div className="store-list">
          {modules.map((m) => (
            <ModuleCard key={m.id} module={m} onClick={() => onPick(m)} />
          ))}
        </div>
      )}
    </section>
  );
}

function ModuleCard({ module: m, onClick }) {
  return (
    <button className="card store-card clickable" onClick={onClick}>
      <div className="store-thumb">
        {m.image ? (
          <img src={m.image} alt="" loading="lazy" />
        ) : (
          <span className="store-thumb-ph">🪞</span>
        )}
      </div>
      <div className="store-card-body">
        <div className="store-card-top">
          <h4>{m.name}</h4>
          {m.installed && <span className="store-badge">nainstalováno</span>}
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
