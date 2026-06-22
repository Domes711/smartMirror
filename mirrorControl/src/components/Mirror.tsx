import type { CSSProperties } from "react";
import { useAppSelector } from "@/app/hooks";
import { REGIONS } from "@/data/catalog";
import type { Regions, RegionId } from "@/types";
import { Widget } from "./Widget";

const C = {
  paper: "#E9E8DD", p2: "#EFEEE4", p3: "#E2E1D5", ink: "#1A1A17", mute: "#8C8C81",
  line: "#CFCEC2", signal: "#E5482F", bsoft: "#ffe6b3", bline: "#f0ad33", bink: "#6B6212",
};

export type MirrorMode = "preview" | "edit" | "thumb";

interface MirrorProps {
  regions: Regions;
  mode: MirrorMode;
  onZoneTap?: (rid: RegionId) => void;
}

/** Faithful port of the prototype mirror() renderer. */
export function Mirror({ regions, mode, onZoneTap }: MirrorProps) {
  const en = useAppSelector((s) => s.ui.lang === "en");
  const picked = useAppSelector((s) => s.scenes.picked);
  const selChip = useAppSelector((s) => s.scenes.selChip);

  const isThumb = mode === "thumb";
  const isEdit = mode === "edit";
  const held = isEdit && !!(picked || selChip);
  const moveSource = isEdit && selChip ? selChip.region : null;

  const cells = REGIONS.map((r) => {
    const mods = regions[r.id] || [];
    if (mode === "preview" && mods.length === 0 && r.full) return null;
    const empty = mods.length === 0;
    const isSource = isEdit && moveSource === r.id;

    const base: CSSProperties = {
      borderRadius: isThumb ? 2 : isEdit ? 11 : 8,
      position: "relative",
      minHeight: isThumb ? 7 : isEdit ? (r.full ? 36 : 60) : mods.length ? 30 : 0,
      gridColumn: r.full ? "1 / -1" : "auto",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
    };
    if (isEdit) {
      base.padding = "15px 9px 9px";
      base.cursor = isSource ? "not-allowed" : "pointer";
      base.transition = "background .16s, border-color .16s";
      base.background = isSource ? C.paper : held ? C.bsoft : empty ? "rgba(26,26,23,.022)" : C.paper;
      base.border = isSource ? `1px solid ${C.line}` : held ? `1px dashed ${C.bline}` : `1px solid ${C.line}`;
    }

    let children: React.ReactNode = null;
    if (isThumb) {
      children = mods.length ? <span style={{ height: 6, borderRadius: 2, background: "rgba(233,232,221,.5)", width: "100%" }} /> : null;
    } else if (isEdit) {
      const cnt = mods.length;
      children = (
        <>
          <span
            style={{
              position: "absolute", top: 6, left: 9, fontFamily: "var(--mono)", fontSize: 7,
              letterSpacing: ".14em", textTransform: "uppercase",
              color: empty ? (held ? C.bink : C.mute) : "#3a3a34",
            }}
          >
            {en ? r.label : r.cs || r.label}
          </span>
          {!empty && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 34 }}>
              <span
                style={{
                  display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  minWidth: 40, height: 40, padding: "3px 10px",
                  border: `1px solid ${isSource ? C.signal : C.line}`, borderRadius: 10,
                  background: isSource ? "rgba(229,72,47,.12)" : C.p2, fontFamily: "var(--mono)", lineHeight: 1,
                }}
              >
                <b style={{ fontSize: 17, fontWeight: 700, color: isSource ? C.signal : C.ink }}>{cnt}</b>
                <span style={{ fontSize: 6.5, letterSpacing: ".1em", textTransform: "uppercase", color: isSource ? C.signal : C.mute, marginTop: 3 }}>
                  {en ? (cnt === 1 ? "widget" : "widgets") : "widgetů"}
                </span>
              </span>
            </div>
          )}
          {empty && (
            <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", fontFamily: "var(--grotesk)", fontWeight: 300, fontSize: 17, color: held ? C.bink : "rgba(26,26,23,.28)" }}>
              +
            </span>
          )}
        </>
      );
    } else {
      children = (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", justifyContent: r.j || "flex-start" }}>
          {mods.map((m, i) => (
            <div key={m + i}>
              <Widget id={m} />
            </div>
          ))}
        </div>
      );
    }

    return (
      <div key={r.id} style={base} onClick={isEdit && !isSource ? () => onZoneTap?.(r.id) : undefined}>
        {children}
      </div>
    );
  });

  const cont: CSSProperties = {
    background: isEdit ? C.p3 : C.ink,
    borderRadius: isThumb ? 9 : 16,
    padding: isThumb ? 6 : isEdit ? 10 : 12,
    display: "grid",
    gap: isThumb ? 3 : isEdit ? 6 : 7,
    gridTemplateColumns: "1fr 1fr 1fr",
    color: isEdit ? C.ink : C.paper,
    position: "relative",
    overflow: "hidden",
  };
  if (isEdit) cont.border = `1px solid ${C.line}`;
  if (mode === "preview") cont.aspectRatio = "9 / 14";
  if (isThumb) cont.aspectRatio = "9 / 13";

  return <div style={cont}>{cells}</div>;
}
