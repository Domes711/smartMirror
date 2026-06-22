import type { CSSProperties } from "react";
import { useT } from "@/i18n/useT";

interface Props {
  aspect?: string | false;
  height?: number | string;
  radius?: number | string;
  label?: string;
}

/** Dark mirror panel + region skeleton + red scan sweep + status. */
export function MirrorLoader({ aspect = "9 / 14", height, radius = 14, label }: Props) {
  const { L } = useT();
  const bar = (w: string) => (
    <div style={{ height: 9, width: w, borderRadius: 3, background: "rgba(233,232,221,.12)", animation: "mc-shimmer 1.7s ease-in-out infinite" }} />
  );

  const cont: CSSProperties = { background: "#1A1A17", borderRadius: radius, position: "relative", overflow: "hidden" };
  if (aspect !== false) cont.aspectRatio = aspect;
  if (height) cont.height = height;

  return (
    <div style={cont}>
      <div style={{ position: "absolute", inset: 16, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          {bar("32%")}
          {bar("24%")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
          {bar("48%")}
          {bar("30%")}
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>{bar("42%")}</div>
      </div>
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: 0, height: 2,
          background: "linear-gradient(90deg,transparent,rgba(229,72,47,.15) 20%,#E5482F 50%,rgba(229,72,47,.15) 80%,transparent)",
          boxShadow: "0 0 14px 2px rgba(229,72,47,.45)", animation: "mc-scan 1.6s ease-in-out infinite alternate",
        }}
      />
      <div
        style={{
          position: "absolute", bottom: 18, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center",
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "#8e8d83",
        }}
      >
        {label || L.loadingMirror}
        <span style={{ display: "inline-flex", gap: 3, marginLeft: 5 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "#E5482F", animation: `mc-blink 1.2s ${i * 0.18}s infinite` }} />
          ))}
        </span>
      </div>
    </div>
  );
}
