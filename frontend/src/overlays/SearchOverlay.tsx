import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { MiniThumb } from "@/components/MiniThumb";
import { tokens as C } from "@/components/ui";
import { modulesActions } from "@/features/modules/modulesSlice";
import { STORE, CATEGORIES } from "@/data/catalog";
import * as fx from "@/app/thunks";

const ROWS = [
  ["q", "w", "e", "r", "t", "z", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["y", "x", "c", "v", "b", "n", "m"],
];

export function SearchOverlay() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const open = useAppSelector((s) => s.modules.searchOpen);
  const search = useAppSelector((s) => s.modules.search);
  const searchCat = useAppSelector((s) => s.modules.searchCat);
  const installed = useAppSelector((s) => s.modules.installed);
  const deletedMods = useAppSelector((s) => s.modules.deletedMods);
  if (!open) return null;

  let sugg = STORE(en).filter((m) => !deletedMods.includes(m.n));
  if (searchCat) sugg = sugg.filter((m) => m.t.includes(searchCat));
  const q = search.trim().toLowerCase();
  if (q) sugg = sugg.filter((m) => (m.n + " " + m.c + " " + m.d + " " + m.t.join(" ")).toLowerCase().includes(q));
  const suggArr = sugg.slice(0, 20);

  const Key = ({ ch }: { ch: string }) => (
    <button onClick={() => dispatch(modulesActions.appendSearch(ch))} style={{ flex: 1, minWidth: 0, height: 42, borderRadius: 7, border: "none", background: C.paper, fontFamily: "var(--grotesk)", fontSize: 16, cursor: "pointer", boxShadow: "0 1px 0 rgba(0,0,0,.12)" }}>{ch}</button>
  );

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 70, background: C.paper, display: "flex", flexDirection: "column", animation: "mc-fade .18s ease" }}>
      <div style={{ padding: "calc(16px + env(safe-area-inset-top)) 18px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 9, background: C.p3, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px" }}>
          <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: "none", stroke: C.mute, strokeWidth: 1.8, strokeLinecap: "round" }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input autoFocus value={search} onChange={(e) => dispatch(modulesActions.setSearch(e.target.value))} placeholder={L.searchPh} style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontFamily: "var(--mono)", fontSize: 13, color: C.ink }} />
          {search && <button onClick={() => dispatch(modulesActions.clearSearch())} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.mute, fontSize: 16 }}>×</button>}
        </div>
        <button onClick={() => dispatch(modulesActions.setSearchOpen(false))} style={{ border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 12, color: C.ink }}>{L.searchCancel}</button>
      </div>

      <div className="mc-noscroll" style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
        {!search && (
          <div className="mc-noscroll" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {CATEGORIES.map((c) => {
              const sel = searchCat === c.tag;
              return (
                <button key={c.tag} onClick={() => dispatch(modulesActions.setSearchCat(sel ? null : c.tag))} style={{ fontFamily: "var(--mono)", fontSize: 11.5, border: `1px solid ${sel ? C.ink : C.line}`, background: sel ? C.ink : "transparent", color: sel ? C.paper : C.ink, borderRadius: 999, padding: "7px 13px", cursor: "pointer" }}>{en ? c.en : c.cs}</button>
              );
            })}
          </div>
        )}
        {suggArr.map((m) => (
          <button key={m.n} onClick={() => { dispatch(modulesActions.setSearchOpen(false)); dispatch(fx.openDetail(m)); }} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, border: "none", background: "transparent", cursor: "pointer", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: "0 0 44px", height: 44, borderRadius: 9, background: C.ink, display: "grid", placeItems: "center", overflow: "hidden" }}><MiniThumb m={m} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{m.c}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: C.mute }}>{m.n}{installed.includes(m.n) ? " · ✓" : ""}</div>
            </div>
          </button>
        ))}
        {suggArr.length === 0 && <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: C.mute, padding: "16px 0" }}>{L.noResults}</p>}
      </div>

      <div style={{ background: "#d6d5c9", padding: "8px 6px calc(8px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 7 }}>
        {ROWS.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 5, padding: i === 1 ? "0 16px" : i === 2 ? "0 6px" : 0 }}>
            {i === 2 && <button onClick={() => dispatch(modulesActions.backspaceSearch())} style={{ flex: 1.4, height: 42, borderRadius: 7, border: "none", background: "#bcbbb0", cursor: "pointer", fontSize: 16 }}>⌫</button>}
            {row.map((ch) => <Key key={ch} ch={ch} />)}
            {i === 2 && <button onClick={() => dispatch(modulesActions.appendSearch(" "))} style={{ flex: 1.4, height: 42, borderRadius: 7, border: "none", background: "#bcbbb0", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11 }}>{L.kbSpace}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
