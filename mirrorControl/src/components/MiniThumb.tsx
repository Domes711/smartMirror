import type { Module, Draft } from "@/types";

/** The mono mini-preview lines shown on a dark store thumbnail — or the real
 * store screenshot when connected to a live mirror (`img`). */
export function MiniThumb({ m }: { m: Pick<Module | Draft, "mini"> & { img?: string } }) {
  if (m.img) {
    return <img src={m.img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => ((e.currentTarget.style.display = "none"))} />;
  }
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
