import type { Module, Draft } from "@/types";

/** The mono mini-preview lines shown on a dark store thumbnail. */
export function MiniThumb({ m }: { m: Pick<Module | Draft, "mini"> }) {
  return (
    <div style={{ color: "#E9E8DD", fontFamily: "var(--mono)", fontSize: 8, lineHeight: 1.5, padding: 7, width: "100%" }}>
      {(m.mini || []).map((l, i) => (
        <div key={i} style={{ minHeight: 10 }}>
          {l}
        </div>
      ))}
    </div>
  );
}
