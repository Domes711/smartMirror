import { useCallback, useEffect, useRef, useState } from "react";
import LoadingOverlay from "./LoadingOverlay.jsx";
import Markdown from "./Markdown.jsx";
import ModuleEditor from "./ModuleEditor.jsx";
import { useToast } from "./Toast.jsx";

// App-store style module detail: image gallery on top, an install / uninstall
// button (with live % during install), and the README rendered below.
const BADGE_RE = /shields\.io|badgen\.net|travis-ci|circleci|codecov|\.svg([?#]|$)/i;

export default function ModuleDetail({ module: m, onBack }) {
  const cat = m.catalog;
  const [readme, setReadme] = useState(null); // { markdown, baseUrl } | null
  const [images, setImages] = useState(() => {
    const base = m.images?.length ? m.images : m.image ? [m.image] : [];
    // mm-store screenshots only as fallback when module has no images of its own.
    const storeScreens = base.length === 0 ? (cat?.screenshots || []) : [];
    return [...new Set([...storeScreens, ...base].filter(Boolean))];
  });
  const [installed, setInstalled] = useState(!!m.installed);

  // install progress
  const [installing, setInstalling] = useState(false);
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState("");
  const [working, setWorking] = useState(null); // overlay message
  const [editing, setEditing] = useState(false);
  const poll = useRef(null);
  const toast = useToast();

  // Load README + harvest extra gallery images from it.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `/store/readme?id=${encodeURIComponent(m.id)}&url=${encodeURIComponent(m.url || "")}`
        );
        const b = await r.json();
        if (!alive) return;
        setReadme(b);
        const found = extractImages(b.markdown || "", b.baseUrl || "");
        setImages((cur) => dedupe([...cur, ...found]));
      } catch {
        if (alive) setReadme({ markdown: "", baseUrl: "" });
      }
    })();
    return () => {
      alive = false;
      if (poll.current) clearInterval(poll.current);
    };
  }, [m.id, m.url]);

  const startInstall = useCallback(async () => {
    setInstalling(true);
    setPercent(2);
    setPhase("starting");
    try {
      const r = await fetch("/store/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || `install ${r.status}`);
    } catch (e) {
      setInstalling(false);
      toast.error(`Instalace selhala: ${e.message}`);
      return;
    }
    poll.current = setInterval(async () => {
      try {
        const r = await fetch(`/store/install/status?id=${encodeURIComponent(m.id)}`);
        const s = await r.json();
        setPercent(s.percent || 0);
        setPhase(s.phase || "");
        if (s.done) {
          clearInterval(poll.current);
          setInstalling(false);
          if (s.ok) {
            setInstalled(true);
            toast.success(`${m.name} nainstalován. Umísti ho v Rozložení.`);
            setTimeout(() => onBack(), 1200);
          } else {
            toast.error(s.error || "Instalace selhala");
          }
        }
      } catch {
        /* keep polling */
      }
    }, 1000);
  }, [m.id, m.name, onBack, toast]);

  const uninstall = useCallback(async () => {
    if (!window.confirm(`Odinstalovat ${m.name}? Modul se smaže ze složky a z configu.`))
      return;
    setWorking("Odinstalovávám + restartuji…");
    try {
      const r = await fetch("/store/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: m.name }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || `uninstall ${r.status}`);
      setInstalled(false);
      toast.success(`${m.name} odinstalován.`);
      setTimeout(() => onBack(), 800);
    } catch (e) {
      setWorking(null);
      toast.error(`Odinstalace selhala: ${e.message}`);
    }
  }, [m.name, onBack, toast]);

  const phaseLabel = PHASE_LABELS[phase] || "Instaluji…";

  // Edit mode: the shared chat + live-preview editor over the installed module.
  if (editing) {
    return (
      <ModuleEditor
        scope="installed"
        name={m.name}
        title={m.name}
        autoPrepare
        greeting={`Načítám ${m.name} k úpravám…`}
        onBack={() => setEditing(false)}
        actions={<RestartButton />}
      />
    );
  }

  const originName = cat?.name?.origin || m.name;
  const localName = cat?.name?.cs || cat?.name?.en || "";
  const storeDesc = cat?.description?.cs || cat?.description?.en || "";

  if (readme === null) {
    return (
      <div className="panel">
        <div className="wizard-head">
          <button className="mqtt-btn compact" onClick={onBack}>← Obchod</button>
          <div className="detail-title">
            <strong>{originName}</strong>
            {localName && localName !== originName && (
              <span className="detail-title-sub">{localName}</span>
            )}
          </div>
        </div>
        <div className="card status-card">
          <div className="spinner" />
          <p style={{ color: "var(--muted)", margin: "12px 0 0", fontSize: "0.85rem" }}>Načítám…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <LoadingOverlay show={!!working} message={working} />

      <div className="wizard-head">
        <button className="mqtt-btn compact" onClick={onBack}>← Obchod</button>
        <div className="detail-title">
          <strong>{originName}</strong>
          {localName && localName !== originName && (
            <span className="detail-title-sub">{localName}</span>
          )}
        </div>
      </div>

      <div className="detail-scroll">
        <Gallery images={images} />

        {/* Tags (left) + maintainer (right) below gallery */}
        {(cat?.tags?.length > 0 || m.maintainer) && (
          <div className="detail-meta-row">
            <div className="store-tags">
              {(cat?.tags || []).map(tag => (
                <span key={tag} className="store-tag">{tag}</span>
              ))}
            </div>
            {m.maintainer && (
              <span className="detail-maintainer">👤 {m.maintainer}</span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="store-detail-actions">
          {installed ? (
            <>
              <div className="store-detail-row">
                <button className="mqtt-btn k-ok store-install-btn" onClick={() => setEditing(true)}>
                  Upravit
                </button>
                <button className="mqtt-btn k-bad store-install-btn" onClick={uninstall}>
                  Odinstalovat
                </button>
              </div>
              {m.url && (
                <div className="store-detail-row">
                  <a className="mqtt-btn compact store-source-btn" href={m.url} target="_blank" rel="noreferrer">
                    Zdroj ↗
                  </a>
                </div>
              )}
            </>
          ) : (
            <div className="store-detail-row">
              <button
                className="mqtt-btn k-ok store-install-btn"
                onClick={startInstall}
                disabled={installing}
              >
                {installing ? (
                  <>
                    <span className="store-progress-fill" style={{ width: `${percent}%` }} />
                    <span className="store-progress-label">{phaseLabel} {percent}%</span>
                  </>
                ) : (
                  "Instalovat"
                )}
              </button>
              {m.url && (
                <a className="mqtt-btn compact store-source-btn" href={m.url} target="_blank" rel="noreferrer">
                  Zdroj ↗
                </a>
              )}
            </div>
          )}
        </div>

        {/* mm-store description */}
        {storeDesc && <p className="detail-store-desc">{storeDesc}</p>}

        {/* Original README */}
        {readme.markdown ? (
          <>
            {storeDesc && <h3 className="detail-section-head">Originální popis</h3>}
            <div className="store-readme">
              <Markdown source={readme.markdown} />
            </div>
          </>
        ) : (
          !storeDesc && (
            <p className="store-note">{m.description || "Popis není k dispozici."}</p>
          )
        )}
      </div>
    </div>
  );
}

// Apply in-place edits to the live mirror (pm2 restart MagicMirror).
function RestartButton() {
  const [state, setState] = useState(""); // "" | "busy" | "ok" | "err"
  const restart = async () => {
    setState("busy");
    try {
      const r = await fetch("/api/modules/edit/restart", { method: "POST" });
      setState(r.ok ? "ok" : "err");
    } catch {
      setState("err");
    }
  };
  const label =
    state === "busy" ? "Restartuji…" : state === "ok" ? "Restartováno ✓" : state === "err" ? "Restart selhal" : "Restartovat zrcadlo";
  return (
    <button className="mqtt-btn compact" disabled={state === "busy"} onClick={restart} title="Aplikovat změny na běžící zrcadlo">
      {label}
    </button>
  );
}

const PHASE_LABELS = {
  starting: "Spouštím…",
  cloning: "Stahuji…",
  cloned: "Staženo…",
  npm: "Závislosti…",
  registering: "Registruji…",
  analysing: "Analyzuji modul…",
  done: "Hotovo",
  error: "Chyba",
};

function Gallery({ images }) {
  const [idx, setIdx] = useState(0);
  if (!images || images.length === 0) {
    return (
      <div className="store-gallery">
        <div className="store-gallery-main store-gallery-ph">🪞</div>
      </div>
    );
  }
  const cur = Math.min(idx, images.length - 1);
  return (
    <div className="store-gallery">
      <div className="store-gallery-main">
        <img src={images[cur]} alt="" onError={(e) => (e.target.style.opacity = 0.2)} />
      </div>
      {images.length > 1 && (
        <div className="store-gallery-thumbs">
          {images.map((src, i) => (
            <button
              key={src}
              className={"store-gallery-thumb" + (i === cur ? " active" : "")}
              onClick={() => setIdx(i)}
            >
              <img src={src} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function extractImages(markdown, baseUrl) {
  const out = [];
  const add = (u) => {
    const r = resolve(u, baseUrl);
    if (r && !BADGE_RE.test(r)) out.push(r);
  };
  let m;
  const md = /!\[[^\]]*\]\(([^)\s]+)/g;
  while ((m = md.exec(markdown)) !== null) add(m[1]);
  const html = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((m = html.exec(markdown)) !== null) add(m[1]);
  return out;
}

function resolve(url, baseUrl) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) return null;
  try {
    return new URL(url.replace(/^\.?\//, ""), baseUrl).href;
  } catch {
    return null;
  }
}

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}
