import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { MiniThumb } from "@/components/MiniThumb";
import { PillButton, tokens as C, h1 } from "@/components/ui";
import { modulesActions } from "@/features/modules/modulesSlice";
import { STORE, BROWSE_COUNT, CATEGORIES } from "@/data/catalog";
import * as fx from "@/app/thunks";

export default function Modules() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const m = useAppSelector((s) => s.modules);

  const all = STORE(en).filter((x) => !m.deletedMods.includes(x.n));
  let mods = all;
  if (m.modFilter === "installed") mods = all.filter((x) => m.installed.includes(x.n));
  else if (m.modFilter === "search") {
    if (m.searchCat) mods = all.filter((x) => x.t.includes(m.searchCat!));
    if (m.search.trim()) {
      const q = m.search.trim().toLowerCase();
      mods = mods.filter((x) => (x.n + " " + x.c + " " + x.d + " " + x.t.join(" ")).toLowerCase().includes(q));
    }
  }

  const catActive = m.searchCat ? CATEGORIES.find((c) => c.tag === m.searchCat) : null;

  const Tab = ({ id, label }: { id: typeof m.modFilter; label: string }) => {
    const sel = m.modFilter === id;
    return (
      <button onClick={() => dispatch(modulesActions.setFilter(id))} style={{ border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".04em", textTransform: "uppercase", padding: "0 1px 11px", marginBottom: -1, color: sel ? C.ink : C.mute, borderBottom: `2px solid ${sel ? C.ink : "transparent"}`, whiteSpace: "nowrap", transition: ".15s" }}>{label}</button>
    );
  };

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ flex: "0 0 auto" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={h1}>{L.modulesTitle}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 9, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 14px 6px 8px", fontFamily: "var(--mono)", fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.butter, border: `1px solid ${C.bline}` }} />
            <span>{BROWSE_COUNT}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, borderBottom: `1px solid ${C.line}`, margin: "31px 0 18px" }}>
          <Tab id="mine" label={`${L.pillMine} · ${all.length}`} />
          <Tab id="installed" label={`${L.pillInstalled} · ${m.installed.length}`} />
          <Tab id="search" label={`${L.pillSearch} · ${BROWSE_COUNT}`} />
        </div>

        {m.modFilter === "mine" && (
          <PillButton full style={{ margin: "0 0 16px" }} onClick={() => dispatch(fx.nav("create", "modules"))}>
            <span style={{ fontFamily: "var(--grotesk)", fontWeight: 700, marginRight: 6 }}>+</span>
            {L.createAI}
          </PillButton>
        )}

        {m.modFilter === "search" && (
          <div onClick={() => dispatch(modulesActions.setSearchOpen(true))} style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 9, background: C.p3, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 14px", cursor: "text" }}>
            <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, flex: "0 0 auto", fill: "none", stroke: C.mute, strokeWidth: 1.8, strokeLinecap: "round" }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            {catActive ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--mono)", fontSize: 11.5, background: C.ink, color: C.paper, borderRadius: 999, padding: "5px 6px 5px 11px" }}>
                {en ? catActive.en : catActive.cs}
                <button onClick={(e) => { e.stopPropagation(); dispatch(modulesActions.setSearchCat(null)); }} style={{ width: 16, height: 16, border: "none", background: "rgba(233,232,221,.22)", borderRadius: "50%", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 10, color: C.paper, lineHeight: 1 }}>×</button>
              </span>
            ) : (
              <span style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 13, color: m.search ? C.ink : C.mute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.search || L.searchPh}</span>
            )}
          </div>
        )}
      </div>

      <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "6px 22px 28px" }}>
        {mods.map((x) => (
          <div key={x.n} onClick={() => dispatch(fx.openDetail(x))} className="mc-lift" style={{ border: `1px solid ${C.line}`, borderRadius: 16, background: C.p2, padding: 16, marginBottom: 14, cursor: "pointer", display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ flex: "0 0 70px", height: 70, borderRadius: 10, background: C.ink, display: "grid", placeItems: "center", border: `1px solid ${C.ink}`, overflow: "hidden" }}><MiniThumb m={x} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, lineHeight: 1.2, overflowWrap: "anywhere" }}>{x.c}</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "3px 0 5px" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>{x.n}</span>
                {m.installed.includes(x.n) && <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: C.mute, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 9px" }}>✓ {L.installed}</span>}
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.4, color: C.ink2, margin: 0 }}>{x.d}</p>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 9 }}>
                {x.t.map((t) => <span key={t} style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.mute, border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}>{t}</span>)}
              </div>
            </div>
          </div>
        ))}
        {mods.length === 0 && <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: C.mute, lineHeight: 1.6, padding: "20px 0" }}>{L.noResults}</p>}
      </div>
    </section>
  );
}
