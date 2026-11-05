import { useEffect, useMemo, useRef, useState } from "react";
import type { MqttMsg } from "@/types";

/** JSON payloads pretty-printed, anything else (plain strings) as-is. */
function pretty(payload: string): string {
  const s = payload.trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return payload;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return payload;
  }
}

// Zoom = the log's font size in px. Starts small so a whole payload fits
// at a glance; pinch (two fingers), the −/+ buttons or ctrl+wheel zoom in.
// The app viewport has maximum-scale=1, so browser pinch-zoom is off —
// this is the log's own.
const ZOOM_MIN = 6;
const ZOOM_MAX = 28;
const ZOOM_DEFAULT = 8;
const ZOOM_KEY = "mc.devLogZoom";
const clampZoom = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v * 2) / 2));

function loadZoom(): number {
  try {
    const v = parseFloat(localStorage.getItem(ZOOM_KEY) ?? "");
    return Number.isFinite(v) ? clampZoom(v) : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

/**
 * Full-screen message log detail (dev → Komunikace → Záznam zpráv).
 * The body scrolls both ways — long payloads are never wrapped or clipped,
 * so you can pan right to read them. "Pause" freezes the list so incoming
 * traffic doesn't shift it while you're reading. Zoomable (see ZOOM_*).
 */
export function MessageLogDetail({ msgs, en, onClose }: { msgs: MqttMsg[]; en: boolean; onClose: () => void }) {
  const [frozen, setFrozen] = useState<MqttMsg[] | null>(null);
  const shown = frozen ?? msgs;
  const [zoom, setZoom] = useState(loadZoom);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      /* per-viewer convenience only */
    }
  }, [zoom]);

  // Pinch + ctrl+wheel. Native listeners: touchmove/wheel must be
  // non-passive to preventDefault, which React's synthetic ones aren't.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pinch: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { dist: dist(e.touches), zoom: zoomRef.current };
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      setZoom(clampZoom(pinch.zoom * (dist(e.touches) / pinch.dist)));
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  const rendered = useMemo(() => shown.map((m) => ({ ...m, body: pretty(m.payload) })), [shown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const btn = { fontFamily: "var(--mono)", fontSize: 11.5, padding: "8px 12px", borderRadius: 999, border: "1px solid #3a3a34", background: "transparent", color: "#e9e8dd", cursor: "pointer" } as const;

  return (
    <div role="dialog" aria-label={en ? "Message log" : "Záznam zpráv"} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "#0c0d0b", color: "#cfcec2", display: "flex", flexDirection: "column", animation: "scin .2s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "calc(env(safe-area-inset-top) + 12px) 16px 12px", borderBottom: "1px solid #20211d", flex: "0 0 auto" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "#e9e8dd" }}>{en ? "Message log" : "Záznam zpráv"}</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "#6f6e66" }}>
            {shown.length} {en ? "messages" : "zpráv"} · {frozen ? (en ? "paused" : "pozastaveno") : en ? "live" : "živě"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", border: "1px solid #3a3a34", borderRadius: 999 }}>
          <button onClick={() => setZoom((z) => clampZoom(z - 1))} aria-label={en ? "Zoom out" : "Oddálit"} disabled={zoom <= ZOOM_MIN} style={{ ...btn, border: "none", width: 34, padding: "8px 0", opacity: zoom <= ZOOM_MIN ? 0.35 : 1 }}>−</button>
          <button onClick={() => setZoom(ZOOM_DEFAULT)} aria-label={en ? "Reset zoom" : "Výchozí velikost"} style={{ ...btn, border: "none", padding: "8px 2px", minWidth: 34, fontSize: 10.5, color: "#8c8c81" }}>{Math.round((zoom / ZOOM_DEFAULT) * 100)}%</button>
          <button onClick={() => setZoom((z) => clampZoom(z + 1))} aria-label={en ? "Zoom in" : "Přiblížit"} disabled={zoom >= ZOOM_MAX} style={{ ...btn, border: "none", width: 34, padding: "8px 0", opacity: zoom >= ZOOM_MAX ? 0.35 : 1 }}>+</button>
        </div>
        <button onClick={() => setFrozen(frozen ? null : msgs)} aria-label={frozen ? (en ? "Resume" : "Pokračovat") : en ? "Pause" : "Pozastavit"} style={{ ...btn, width: 36, height: 36, padding: 0, borderColor: frozen ? "#ffc34d" : "#3a3a34", color: frozen ? "#ffc34d" : "#e9e8dd" }}>
          {frozen ? "▶" : "❚❚"}
        </button>
        <button onClick={onClose} aria-label={en ? "Close" : "Zavřít"} style={{ ...btn, width: 36, height: 36, padding: 0, fontSize: 16 }}>
          ×
        </button>
      </div>

      {/* both axes scroll; touch-action lets a finger pan in any direction */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y", padding: "8px 16px calc(env(safe-area-inset-bottom) + 16px)" }}>
        <div style={{ display: "inline-block", minWidth: "100%", fontFamily: "var(--mono)", fontSize: zoom, lineHeight: 1.35 }}>
          {rendered.length === 0 && <div style={{ color: "#6f6e66", padding: "12px 0" }}>—</div>}
          {rendered.map((m, i) => (
            <div key={`${m.t}-${i}`} style={{ padding: "10px 0", borderBottom: "1px solid #1a1b18" }}>
              <div style={{ display: "flex", gap: 8, whiteSpace: "nowrap" }}>
                <span style={{ color: "#6f6e66" }}>{m.t}</span>
                <span style={{ color: m.dirColor }}>{m.dir}</span>
                <span style={{ color: "#9fd9b0" }}>{m.topic}</span>
              </div>
              <pre style={{ margin: "4px 0 0", whiteSpace: "pre", color: "#b9b8ad", font: "inherit" }}>{m.body}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
