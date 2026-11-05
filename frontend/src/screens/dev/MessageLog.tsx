import { useEffect, useMemo, useState } from "react";
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

/**
 * Full-screen message log detail (dev → Komunikace → Záznam zpráv).
 * The body scrolls both ways — long payloads are never wrapped or clipped,
 * so you can pan right to read them. "Pause" freezes the list so incoming
 * traffic doesn't shift it while you're reading.
 */
export function MessageLogDetail({ msgs, en, onClose }: { msgs: MqttMsg[]; en: boolean; onClose: () => void }) {
  const [frozen, setFrozen] = useState<MqttMsg[] | null>(null);
  const shown = frozen ?? msgs;
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
        <button onClick={() => setFrozen(frozen ? null : msgs)} style={{ ...btn, borderColor: frozen ? "#ffc34d" : "#3a3a34", color: frozen ? "#ffc34d" : "#e9e8dd" }}>
          {frozen ? (en ? "▶ Resume" : "▶ Pokračovat") : en ? "❚❚ Pause" : "❚❚ Pozastavit"}
        </button>
        <button onClick={onClose} aria-label={en ? "Close" : "Zavřít"} style={{ ...btn, width: 36, height: 36, padding: 0, fontSize: 16 }}>
          ×
        </button>
      </div>

      {/* both axes scroll; touch-action lets a finger pan in any direction */}
      <div style={{ flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y", padding: "8px 16px calc(env(safe-area-inset-bottom) + 16px)" }}>
        <div style={{ display: "inline-block", minWidth: "100%", fontFamily: "var(--mono)", fontSize: 11.5 }}>
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
