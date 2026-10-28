import { useState, useEffect } from "react";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import { useGetCameraHealthQuery, useSetCameraModeMutation } from "@/app/api/cameraApi";

type DetectionMode = "learn" | "test_face" | "test_gesture";

const streamUrl = () => "/stream.mjpg";

export default function Camera() {
  const { L, en } = useT();
  const [failed, setFailed] = useState(false);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("learn");
  const [switchingMode, setSwitchingMode] = useState(false);
  const [streamKey, setStreamKey] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  const [setCameraMode] = useSetCameraModeMutation();
  // Health is pushed retained (smartmirror/camera/state) — this query's
  // cache stays live via its onCacheEntryAdded subscription, no polling.
  const { data: health } = useGetCameraHealthQuery();

  useEffect(() => {
    // When the screen mounts, switch to learn mode to enable streaming.
    let mounted = true;
    (async () => {
      try {
        await setCameraMode("learn").unwrap();
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (err) {
        console.error("Failed to switch camera mode:", err);
        if (mounted) setFailed(true);
      }
    })();

    // When the screen unmounts, return to face_detect (camera off, daemon on).
    return () => {
      mounted = false;
      setCameraMode("face_detect").catch((err) => console.error("Failed to restore face_detect mode:", err));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = !health && !failed;

  const handleModeChange = async (mode: DetectionMode) => {
    if (mode === detectionMode || switchingMode) return;
    setSwitchingMode(true);
    setFailed(false);
    try {
      await setCameraMode(mode).unwrap();
      setDetectionMode(mode);
      setStreamKey((prev) => prev + 1); // force <img> reload
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (err) {
      console.error("Failed to switch detection mode:", err);
      setFailed(true);
    } finally {
      setSwitchingMode(false);
    }
  };

  const getDetectionInfo = () => {
    if (detectionMode === "test_face" || detectionMode === "learn") {
      return [{ k: en ? "Person" : "Osoba", v: health?.detected_face || "—" }];
    }
    if (detectionMode === "test_gesture") {
      return [{ k: en ? "Fingers" : "Prsty", v: health?.finger_count != null ? String(health.finger_count) : "—" }];
    }
    return [];
  };

  const rows = getDetectionInfo();

  return (
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease" }}>
      <p style={{ ...eyebrow, margin: "0 0 6px" }}>USB RGB · 640x480 · BlazeFace</p>
      <h2 style={{ ...h2, marginBottom: 14 }}>{L.navCamera}</h2>

      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 3",
          borderRadius: 16,
          overflow: "hidden",
          background: "#0c0d0b",
          border: "1px solid #20211d",
          display: "grid",
          placeItems: "center",
        }}
      >
        {loading || switchingMode ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                border: `2px solid ${C.line}`,
                borderTop: `2px solid ${C.signal}`,
                borderRadius: "50%",
                animation: "mc-sweep .8s linear infinite",
              }}
            />
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "rgba(233,232,221,.55)", letterSpacing: ".08em", textTransform: "uppercase" }}>
              {switchingMode ? (en ? "Switching mode..." : "Přepínám mód...") : en ? "Initializing camera..." : "Spouštím kameru..."}
            </span>
          </div>
        ) : !failed ? (
          <img
            key={streamKey}
            src={`${streamUrl()}?v=${streamKey}`}
            alt="camera"
            onError={() => {
              if (switchingMode) return;
              console.warn("Stream error, retry attempt:", retryCount + 1);
              if (retryCount < 3) {
                const delay = Math.min(1000 * Math.pow(2, retryCount), 4000);
                setTimeout(() => {
                  setRetryCount((prev) => prev + 1);
                  setStreamKey((prev) => prev + 1);
                }, delay);
              } else {
                setFailed(true);
              }
            }}
            onLoad={() => setRetryCount(0)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "rgba(233,232,221,.55)", letterSpacing: ".08em", textTransform: "uppercase" }}>{L.camPreviewHint}</span>
            <button
              onClick={() => {
                setFailed(false);
                setRetryCount(0);
                setStreamKey((prev) => prev + 1);
              }}
              style={{ padding: "8px 16px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: "pointer" }}
            >
              {en ? "Retry" : "Zkusit znovu"}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".08em" }}>{en ? "Detection" : "Detekce"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {(["learn", "test_face", "test_gesture"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleModeChange(mode)}
              disabled={switchingMode}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: detectionMode === mode ? `2px solid ${C.signal}` : `1px solid ${C.line}`,
                background: detectionMode === mode ? C.p3 : "transparent",
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: switchingMode ? C.mute : C.ink,
                cursor: switchingMode ? "wait" : "pointer",
                opacity: switchingMode ? 0.5 : 1,
              }}
            >
              {mode === "learn" ? (en ? "Clean" : "Čistý") : mode === "test_face" ? (en ? "Face" : "Obličej") : en ? "Gesture" : "Gesta"}
            </button>
          ))}
        </div>
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
