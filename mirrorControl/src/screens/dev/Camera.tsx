import { useState, useEffect } from "react";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import { streamUrl, setMode, getMode, setResolution, health } from "@/services/api";

const RESOLUTIONS = [
  { width: 640, height: 480, label: "VGA (640×480)" },
  { width: 1280, height: 720, label: "HD (1280×720)" },
  { width: 1920, height: 1080, label: "Full HD (1920×1080)" },
  { width: 2592, height: 1944, label: "Max (2592×1944)" }
];

export default function Camera() {
  const { L, en } = useT();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previousMode, setPreviousMode] = useState<string | null>(null);
  const [currentResolution, setCurrentResolution] = useState({ width: 640, height: 480 });
  const [changingResolution, setChangingResolution] = useState(false);

  useEffect(() => {
    // When component mounts, switch to learn mode to enable streaming
    let mounted = true;
    (async () => {
      try {
        const current = await getMode();
        const healthStatus = await health();
        if (mounted) {
          setPreviousMode(current.mode);
          setCurrentResolution({ width: healthStatus.width, height: healthStatus.height });
          // Switch to "learn" mode which opens camera and streams
          await setMode("learn");
          // Wait a bit for camera to fully initialize
          await new Promise(resolve => setTimeout(resolve, 500));
          if (mounted) setLoading(false);
        }
      } catch (err) {
        console.error("Failed to switch camera mode:", err);
        if (mounted) {
          setLoading(false);
          setFailed(true);
        }
      }
    })();

    // When component unmounts, restore previous mode
    return () => {
      mounted = false;
      if (previousMode) {
        setMode(previousMode).catch(err =>
          console.error("Failed to restore camera mode:", err)
        );
      }
    };
  }, []);

  const handleResolutionChange = async (width: number, height: number) => {
    setChangingResolution(true);
    setFailed(false);
    try {
      const result = await setResolution(width, height);
      setCurrentResolution({ width: result.width, height: result.height });
      // Wait for camera to reinitialize with new resolution
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error("Failed to change resolution:", err);
      setFailed(true);
    } finally {
      setChangingResolution(false);
    }
  };

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
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, border: `2px solid ${C.line}`, borderTop: `2px solid ${C.signal}`, borderRadius: "50%", animation: "mc-sweep .8s linear infinite" }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "rgba(233,232,221,.55)", letterSpacing: ".08em", textTransform: "uppercase" }}>
              {en ? "Initializing camera..." : "Spouštím kameru..."}
            </span>
          </div>
        ) : !failed ? (
          <img
            src={streamUrl()}
            alt="camera"
            onError={() => setFailed(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "rotate(180deg)"
            }}
          />
        ) : (
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "rgba(233,232,221,.55)", letterSpacing: ".08em", textTransform: "uppercase" }}>{L.camPreviewHint}</span>
        )}
      </div>

      {/* Resolution selector */}
      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".08em" }}>
          {en ? "Resolution" : "Rozlišení"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {RESOLUTIONS.map((res) => (
            <button
              key={`${res.width}x${res.height}`}
              onClick={() => handleResolutionChange(res.width, res.height)}
              disabled={changingResolution || (currentResolution.width === res.width && currentResolution.height === res.height)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: currentResolution.width === res.width && currentResolution.height === res.height
                  ? `2px solid ${C.signal}`
                  : `1px solid ${C.line}`,
                background: currentResolution.width === res.width && currentResolution.height === res.height
                  ? C.p3
                  : "transparent",
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: changingResolution ? C.mute : C.ink,
                cursor: changingResolution ? "wait" : "pointer",
                opacity: changingResolution ? 0.5 : 1,
              }}
            >
              {res.label}
            </button>
          ))}
        </div>
        {changingResolution && (
          <div style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 10, color: C.mute, textAlign: "center" }}>
            {en ? "Reinitializing camera..." : "Restartuju kameru..."}
          </div>
        )}
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
