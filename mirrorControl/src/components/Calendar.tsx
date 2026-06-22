import type { MouseEvent } from "react";
import { useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { Mirror } from "./Mirror";
import { tokens as C } from "./ui";
import { fmod } from "@/data/catalog";
import { resolveActiveId } from "@/app/selectors";
import type { Regions } from "@/types";

export const HOUR_PX = 36;

export interface SceneCard {
  id: string;
  name: string;
  startLabel: string;
  endLabel: string;
  use: string;
  mods: number;
  modsList: string;
  isLive: boolean;
  allDay: boolean;
  startH: number;
  endH: number;
  regions: Regions;
  open: () => void;
}

function LiveBadge() {
  const { L } = useT();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.butter, color: C.bink, borderRadius: 999, padding: "3px 10px", fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.butter, border: `1px solid ${C.bline}` }} />
      {L.onMirror}
    </span>
  );
}

export function Calendar({ cards, showAllDay, onCalClick }: { cards: SceneCard[]; showAllDay?: boolean; onCalClick?: (e: MouseEvent<HTMLDivElement>) => void }) {
  const { L } = useT();
  const time = useAppSelector((s) => s.ui.time);
  const GAP = 6;
  const gridH = 24 * HOUR_PX;
  const allDay = showAllDay ? cards.filter((s) => s.allDay) : [];
  const timed = cards
    .filter((s) => !s.allDay)
    .sort((a, b) => a.startH - b.startH)
    .map((s) => ({ ...s, top: Math.max(0, s.startH) * HOUR_PX, height: Math.max(HOUR_PX * 2 - GAP, (s.endH - s.startH) * HOUR_PX - GAP) }));
  const hours = Array.from({ length: 25 }, (_, h) => ({ h, top: h * HOUR_PX, major: h % 2 === 0 }));
  const now = new Date();
  const nowH = now.getHours() + now.getMinutes() / 60;
  const nowTop = nowH * HOUR_PX;

  return (
    <>
      {allDay.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 10px" }}>
            <span style={{ flex: "0 0 42px", textAlign: "right", fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".12em", textTransform: "uppercase", color: C.mute }}>{L.allDay}</span>
            <div style={{ flex: 1, height: 1, background: C.line }} />
          </div>
          {allDay.map((s) => (
            <div key={s.id} onClick={s.open} className="mc-lift" style={{ margin: "0 0 8px 52px", border: `1px solid ${s.isLive ? C.bline : C.line}`, borderRadius: 16, background: s.isLive ? C.bsoft : C.p2, padding: 14, cursor: "pointer", display: "flex", gap: 13 }}>
              <div style={{ flex: "0 0 64px" }}><Mirror regions={s.regions} mode="thumb" /></div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{s.name}</h3>
                  {s.isLive && <LiveBadge />}
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginTop: 3 }}>{s.use}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.ink2, marginTop: 7 }}>{s.mods} {L.modulesWord} · {s.modsList}</div>
              </div>
            </div>
          ))}
        </>
      )}

      <div onClick={onCalClick} style={{ position: "relative", height: gridH, marginTop: 6, cursor: onCalClick ? "copy" : "default" }}>
        {hours.map((h) => (
          <div key={h.h}>
            <div style={{ position: "absolute", left: 46, right: 0, top: h.top, height: 1, background: h.major ? C.line : "#E2E1D5" }} />
            <span style={{ position: "absolute", left: 0, width: 38, top: h.top, transform: "translateY(-50%)", textAlign: "right", fontFamily: "var(--mono)", fontSize: 10, color: C.mute }}>
              {h.major ? String(h.h).padStart(2, "0") + ":00" : ""}
            </span>
          </div>
        ))}
        {timed.map((s) => (
          <div key={s.id} data-scene-card="1" onClick={(e) => { e.stopPropagation(); s.open(); }} style={{ position: "absolute", left: 50, right: 0, top: s.top, height: s.height, border: `1px solid ${s.isLive ? C.bline : C.line}`, borderRadius: 14, background: s.isLive ? C.bsoft : C.p2, padding: 12, cursor: "pointer", overflow: "hidden", display: "flex", gap: 12, transition: ".16s" }}>
            <div style={{ flex: "0 0 56px" }}><Mirror regions={s.regions} mode="thumb" /></div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{s.name}</h3>
                {s.isLive && <LiveBadge />}
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginTop: 3 }}>{s.startLabel}–{s.endLabel}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.ink2, marginTop: 7 }}>{s.mods} {L.modulesWord} · {s.modsList}</div>
            </div>
          </div>
        ))}
        <div style={{ position: "absolute", left: 46, right: 0, top: nowTop, borderTop: `1px solid ${C.signal}`, zIndex: 5, pointerEvents: "none" }} />
        <span style={{ position: "absolute", left: 46, top: nowTop, transform: "translate(-50%,-50%)", width: 9, height: 9, borderRadius: "50%", background: C.signal, zIndex: 6, pointerEvents: "none" }} />
        <span style={{ position: "absolute", right: 4, top: nowTop, transform: "translateY(-50%)", background: C.signal, color: "#fff", fontFamily: "var(--mono)", fontSize: 9, fontWeight: 700, letterSpacing: ".04em", padding: "2px 6px", borderRadius: 999, zIndex: 6, pointerEvents: "none" }}>{time}</span>
      </div>
    </>
  );
}

/** Build SceneCard[] from the scenes record. */
export function useSceneCards(opts: { onOpen: (id: string) => void; scheduledOnly?: boolean }): SceneCard[] {
  const scenes = useAppSelector((s) => s.scenes.scenes);
  useAppSelector((s) => s.ui.time); // re-resolve as the clock ticks
  const active = resolveActiveId(scenes);
  const en = useAppSelector((s) => s.ui.lang === "en");
  return Object.keys(scenes)
    .map((id) => {
      const sc = scenes[id];
      const mods = Object.values(sc.regions).flat() as string[];
      const sH = sc.startH ?? 0;
      const eH = sc.endH ?? sH + 2;
      return {
        id,
        name: en && sc.name_en ? sc.name_en : sc.name,
        use: en && sc.use_en ? sc.use_en : sc.use,
        startLabel: sc.startLabel || "",
        endLabel: sc.endLabel || "",
        mods: mods.length,
        modsList: mods.map((x) => fmod(x, en)).join(", "),
        isLive: id === active,
        allDay: !!sc.allDay,
        startH: sH,
        endH: eH,
        regions: sc.regions,
        open: () => opts.onOpen(id),
      } as SceneCard;
    })
    .filter((s) => (opts.scheduledOnly ? scenes[s.id].scheduled && !s.allDay : true));
}
