import { useState } from "react";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import { streamUrl } from "@/services/api";

export default function Camera() {
  const { L, en } = useT();
  const [failed, setFailed] = useState(false);

  const rows = [
    { k: en ? "Detector" : "Detektor", v: "BlazeFace" },
    { k: en ? "Recognition" : "Rozpoznání", v: "MobileFaceNet" },
    { k: en ? "Latency" : "Latence", v: "38 ms" },
    { k: en ? "Exposure" : "Expozice", v: "auto · +0.3 EV" },
  ];

  return (
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease" }}>
      <p style={{ ...eyebrow, margin: "0 0 6px" }}>RGB 1080p · IR · face-rec</p>
      <h2 style={{ ...h2, marginBottom: 14 }}>{L.navCamera}</h2>

      <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", borderRadius: 16, overflow: "hidden", background: "#0c0d0b", border: "1px solid #20211d", display: "grid", placeItems: "center" }}>
        {/* REST-only: the MJPEG stream from the supervisor (MQTT can't carry video). */}
        {!failed ? (
          <img src={streamUrl()} alt="camera" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "rgba(233,232,221,.55)", letterSpacing: ".08em", textTransform: "uppercase" }}>{L.camPreviewHint}</span>
        )}
        <span style={{ position: "absolute", top: 11, left: 12, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: C.signal }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.signal, animation: "mc-rec 1.4s steps(1) infinite" }} />live
        </span>
        <span style={{ position: "absolute", bottom: 11, left: 12, fontFamily: "var(--mono)", fontSize: 9, color: "rgba(233,232,221,.6)" }}>1920×1080 · 30 fps</span>
      </div>

      <div style={{ marginTop: 16 }}>
        {rows.map((r) => (
          <div key={r.k} style={{ display: "flex", justifyContent: "space-between", padding: "13px 2px", borderBottom: `1px solid ${C.line}` }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: ".08em" }}>{r.k}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{r.v}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
