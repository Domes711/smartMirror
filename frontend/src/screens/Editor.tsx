import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { Mirror } from "@/components/Mirror";
import { MiniThumb } from "@/components/MiniThumb";
import { BackButton } from "@/components/shell";
import { tokens as C } from "@/components/ui";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { STORE, fmod } from "@/data/catalog";
import * as fx from "@/app/thunks";
import type { Module, RegionId } from "@/types";

export default function Editor() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const s = useAppSelector((st) => st.scenes);
  const installed = useAppSelector((st) => st.modules.installed);
  const deletedMods = useAppSelector((st) => st.modules.deletedMods);
  const catalogEntries = useAppSelector((st) => st.mirror.catalogEntries);

  const editing = s.editing;
  const sc = editing ? s.scenes[editing] : null;
  if (!sc) return null;

  // prefer the live catalog label (Hodiny, Počasí…) for a placeable type
  const label = (id: string) => catalogEntries.find((c) => c.type === id)?.label || fmod(id, en);

  const name = en && sc.name_en ? sc.name_en : sc.name;
  const editMods = Object.values(sc.regions).flat().length;
  const editTime = sc.startLabel && sc.endLabel ? `${sc.startLabel}–${sc.endLabel}` : "—";

  const storeMap: Record<string, Module> = {};
  STORE(en).filter((m) => !deletedMods.includes(m.n)).forEach((m) => (storeMap[m.n] = m));
  const usedSet = new Set(Object.values(sc.regions).flat() as string[]);

  // held banner
  const held = !!(s.picked || s.selChip);
  const heldLabel = s.picked ? `${L.heldPickA} ${label(s.picked)}` : s.selChip ? `${L.heldMoveA} ${label(s.selChip.mod)}` : "";
  const heldCanDelete = !!(s.selChip && s.palRemove);

  const onZoneTap = (rid: RegionId) => {
    if (s.picked || s.selChip) dispatch(fx.regionPlus(rid));
    else dispatch(scenesActions.openZone(rid));
  };

  const pickCard = (m: string, used: boolean) => {
    if (used) dispatch(scenesActions.armPaletteRemove(m));
    else dispatch(scenesActions.pickPalette(m));
  };

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
        <BackButton onClick={() => dispatch(fx.editBack())} />
        <input
          value={name}
          onChange={(e) => dispatch(scenesActions.setSceneName(e.target.value))}
          placeholder={L.nsNamePh}
          style={{ flex: 1, minWidth: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em", border: "none", background: "transparent", outline: "none", color: C.ink, padding: "2px 4px", borderRadius: 7, borderBottom: `1px dashed ${C.line}` }}
        />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.signal, color: "#fff", borderRadius: 999, padding: "5px 11px", fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "mc-rec 1.4s steps(1) infinite" }} />
          {L.live}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => dispatch(scenesActions.openTimeEdit())} className="mc-lift" style={{ display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 12px 6px 13px", fontFamily: "var(--mono)", fontSize: 11, color: C.ink, background: "transparent", cursor: "pointer" }}>
          {editTime}
          <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: "none", stroke: C.mute, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 13px 6px 9px", fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.butter, border: `1px solid ${C.bline}` }} />
          {editMods} {L.modulesWord}
        </span>
      </div>

      {held && (
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 11, border: `1px solid ${C.bline}`, background: C.bsoft, borderRadius: 14, padding: "11px 14px", marginBottom: 14, animation: "mc-fade .25s ease" }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.butter, flex: "0 0 auto" }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.3, color: C.bink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600 }}>{heldLabel} · {L.heldHint}</span>
          {heldCanDelete && (
            <button onClick={() => dispatch(fx.removeModFromScene(s.selChip!.mod))} style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--mono)", fontSize: 10, border: `1px solid ${C.signal}`, color: C.signal, background: "transparent", borderRadius: 999, padding: "6px 11px", cursor: "pointer" }}>
              {L.heldDelete}
            </button>
          )}
          <button onClick={() => dispatch(scenesActions.clearHeld())} style={{ flex: "0 0 auto", fontFamily: "var(--mono)", fontSize: 10, border: `1px solid ${C.bline}`, color: C.bink, background: "transparent", borderRadius: 999, padding: "6px 11px", cursor: "pointer" }}>{L.cancel}</button>
        </div>
      )}

      <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "2px 22px 0" }}>
        <p style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute, margin: "0 0 10px" }}>{L.canvasLabel}</p>
        <Mirror regions={sc.regions} mode="edit" onZoneTap={onZoneTap} />

        <p style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute, margin: "20px 0 0" }}>{L.libraryTitle}</p>
        <div className="mc-noscroll" style={{ display: "flex", gap: 10, overflowX: "auto", padding: "12px 2px 8px" }}>
          {installed.map((m) => {
            const picked = s.picked === m;
            const used = usedSet.has(m);
            const armed = used && s.palRemove === m;
            const sm = storeMap[m];
            return (
              <button key={m} onClick={() => pickCard(m, used)} style={{ flex: "0 0 auto", width: 86, background: "transparent", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", gap: 7, padding: 0, textAlign: "left" }}>
                <div style={{ position: "relative", height: 60, borderRadius: 11, background: C.ink, border: `1.5px solid ${armed ? C.signal : used ? "#CFCEC2" : picked ? C.bline : C.line}`, overflow: "hidden", display: "grid", placeItems: "center", transition: ".15s" }}>
                  {sm && <MiniThumb m={sm} />}
                  {picked && <span style={{ position: "absolute", top: 5, right: 5, width: 15, height: 15, borderRadius: "50%", background: C.butter, color: C.bink, fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center" }}>✓</span>}
                  {used && (
                    <span style={{ position: "absolute", inset: 0, background: armed ? "rgba(229,72,47,.16)" : "rgba(233,232,221,.62)", display: "grid", placeItems: "center" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--mono)", fontSize: 8.5, background: armed ? C.signal : "#1A1A17", color: "#E9E8DD", borderRadius: 999, padding: "3px 8px" }}>
                        <span style={{ fontSize: 9, lineHeight: 1 }}>{armed ? "◉" : "✓"}</span>
                        {armed ? L.markedBadge : L.usedBadge}
                      </span>
                    </span>
                  )}
                </div>
                <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: used ? "#8C8C81" : picked ? C.bink : C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", maxWidth: "100%" }}>{label(m)}</span>
              </button>
            );
          })}
          <button onClick={() => { dispatch(fx.nav("modules", "modules")); }} style={{ flex: "0 0 auto", width: 86, background: "transparent", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", gap: 7, padding: 0, textAlign: "left" }}>
            <div style={{ height: 60, borderRadius: 11, background: C.p3, border: "1.5px dashed #B7B6AA", display: "grid", placeItems: "center" }}>
              <span style={{ fontFamily: "var(--grotesk)", fontWeight: 300, fontSize: 26, color: C.mute, lineHeight: 1 }}>+</span>
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: C.mute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", maxWidth: "100%" }}>{L.moreWidgets}</span>
          </button>
        </div>
      </div>

      <div style={{ flex: "0 0 auto", display: "flex", gap: 10, padding: "14px 0 18px", borderTop: `1px solid ${C.line}`, background: C.paper }}>
        <button onClick={() => dispatch(scenesActions.openDelModal())} style={{ fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "12px 18px", cursor: "pointer", border: `1px solid ${C.signal}`, background: "transparent", color: C.signal }}>{L.del}</button>
        <button onClick={() => dispatch(fx.saveSceneAndBack())} style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "12px 18px", cursor: "pointer", border: `1px solid ${C.ink}`, background: C.ink, color: C.paper }}>{L.saveScene}</button>
      </div>
    </section>
  );
}
