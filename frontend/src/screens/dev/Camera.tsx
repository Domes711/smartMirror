import { useState, useEffect } from "react";
import { useT } from "@/i18n/useT";
import { tokens as C, h2, eyebrow } from "@/components/ui";
import {
  useGetCameraHealthQuery,
  useSetCameraModeMutation,
  useSetCameraSettingsMutation,
  useRestartRecognitionMutation,
} from "@/app/api/cameraApi";

type DetectionMode = "learn" | "test_face" | "test_gesture";

const streamUrl = () => "/stream.mjpg";

const RESOLUTIONS: [number, number][] = [
  [640, 480],
  [1280, 720],
  [1920, 1080],
  [2592, 1944],
];
const AWB_MODES = ["Auto", "Incandescent", "Tungsten", "Fluorescent", "Indoor", "Daylight", "Cloudy", "Custom"];
const NOISE_REDUCTION_MODES = ["Off", "Fast", "HighQuality", "Minimal"];

export default function Camera() {
  const { L, en } = useT();
  const [failed, setFailed] = useState(false);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("learn");
  const [switchingMode, setSwitchingMode] = useState(false);
  const [streamKey, setStreamKey] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  const [setCameraMode] = useSetCameraModeMutation();
  const [setCameraSettings] = useSetCameraSettingsMutation();
  const [restartRecognition, { isLoading: restarting }] = useRestartRecognitionMutation();
  // Health is pushed retained (smartmirror/camera/state) — this query's
  // cache stays live via its onCacheEntryAdded subscription, no polling.
  const { data: health } = useGetCameraHealthQuery();

  // recognition_timeout_s isn't part of CameraHealth — it belongs to the
  // separate camera-recognition process, which only reads it at its own
  // startup, so there's no live value to reflect back here. Kept as local
  // UI state, written through on change; "Apply" restarts that daemon so
  // it actually picks the new value up.
  const [recognitionTimeout, setRecognitionTimeout] = useState(3);
  const [restartNeeded, setRestartNeeded] = useState(false);

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
  const controls = health?.controls;

  const Slider = ({ label, value, min, max, step, fmt, on }: { label: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; on: (v: number) => void }) => (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color: C.ink }}>{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(parseFloat(e.target.value))} style={{ width: "100%", accentColor: C.signal }} />
    </div>
  );

  const Toggle = ({ label, value, on }: { label: string; value: boolean; on: (v: boolean) => void }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute }}>{label}</span>
      <button
        onClick={() => on(!value)}
        style={{ width: 48, height: 28, borderRadius: 999, border: `1px solid ${value ? C.ink : C.line}`, background: value ? C.ink : C.p3, position: "relative", cursor: "pointer", padding: 0 }}
      >
        <span style={{ position: "absolute", top: 2, left: value ? 22 : 2, width: 22, height: 22, borderRadius: "50%", background: value ? C.paper : C.ink, transition: ".18s" }} />
      </button>
    </div>
  );

  const Select = ({ label, value, options, on }: { label: string; value: string; options: string[]; on: (v: string) => void }) => (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 8 }}>{label}</div>
      <select value={value} onChange={(e) => on(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );

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

      {/* --- resolution + frame rate -------------------------------------- */}
      <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
        <p style={{ ...eyebrow, margin: "0 0 6px" }}>{en ? "Resolution & rate" : "Rozlišení a snímkování"}</p>
        <Select
          label={en ? "Resolution" : "Rozlišení"}
          value={health ? `${health.width}x${health.height}` : "640x480"}
          options={RESOLUTIONS.map(([w, h]) => `${w}x${h}`)}
          on={(v) => {
            const [w, h] = v.split("x").map(Number);
            setCameraSettings({ width: w, height: h });
          }}
        />
        <Slider
          label={en ? "Target frame rate" : "Cílové snímkování"}
          value={health?.target_fps ?? 15}
          min={1}
          max={30}
          step={1}
          fmt={(v) => `${Math.round(v)} fps${health ? ` (${en ? "actual" : "reálně"} ${health.fps.toFixed(1)})` : ""}`}
          on={(v) => setCameraSettings({ framerate: Math.round(v) })}
        />
      </div>

      {/* --- recognition tuning -------------------------------------------- */}
      <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
        <p style={{ ...eyebrow, margin: "0 0 6px" }}>{en ? "Recognition" : "Rozpoznávání"}</p>
        <Slider
          label={en ? "Match tolerance" : "Tolerance shody"}
          value={health?.tolerance ?? 0.6}
          min={0.3}
          max={0.9}
          step={0.01}
          fmt={(v) => v.toFixed(2)}
          on={(v) => {
            setCameraSettings({ recognition_tolerance: Math.round(v * 100) / 100 });
            setRestartNeeded(true);
          }}
        />
        <Slider
          label={en ? "Scan timeout" : "Časový limit skenu"}
          value={recognitionTimeout}
          min={1}
          max={10}
          step={0.5}
          fmt={(v) => `${v.toFixed(1)} s`}
          on={(v) => {
            setRecognitionTimeout(v);
            setCameraSettings({ recognition_timeout_s: v });
            setRestartNeeded(true);
          }}
        />
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              restartRecognition();
              setRestartNeeded(false);
            }}
            disabled={restarting}
            style={{ padding: "10px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.p3, fontFamily: "var(--mono)", fontSize: 11, color: C.ink, cursor: restarting ? "wait" : "pointer", opacity: restarting ? 0.6 : 1 }}
          >
            {restarting ? (en ? "Restarting..." : "Restartuji...") : en ? "Restart recognition" : "Restartovat rozpoznávání"}
          </button>
          {restartNeeded && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#d9614a" }}>
              {en ? "restart needed to apply" : "pro uplatnění je potřeba restart"}
            </span>
          )}
        </div>
      </div>

      {/* --- image controls -------------------------------------------- */}
      <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
        <p style={{ ...eyebrow, margin: "0 0 6px" }}>{en ? "Image" : "Obraz"}</p>
        <Slider label={en ? "Brightness" : "Jas"} value={controls?.brightness ?? 0} min={-1} max={1} step={0.05} on={(v) => setCameraSettings({ brightness: v })} />
        <Slider label={en ? "Contrast" : "Kontrast"} value={controls?.contrast ?? 1} min={0} max={2} step={0.05} on={(v) => setCameraSettings({ contrast: v })} />
        <Slider label={en ? "Saturation" : "Sytost"} value={controls?.saturation ?? 1} min={0} max={2} step={0.05} on={(v) => setCameraSettings({ saturation: v })} />
        <Slider label={en ? "Sharpness" : "Ostrost"} value={controls?.sharpness ?? 1} min={0} max={2} step={0.05} on={(v) => setCameraSettings({ sharpness: v })} />
        <Select
          label={en ? "Noise reduction" : "Redukce šumu"}
          value={controls?.noise_reduction ?? "Fast"}
          options={NOISE_REDUCTION_MODES}
          on={(v) => setCameraSettings({ noise_reduction: v })}
        />
      </div>

      {/* --- exposure -------------------------------------------------- */}
      <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
        <p style={{ ...eyebrow, margin: "0 0 6px" }}>{en ? "Exposure" : "Expozice"}</p>
        <Toggle label={en ? "Auto exposure" : "Automatická expozice"} value={controls?.auto_exposure ?? true} on={(v) => setCameraSettings({ auto_exposure: v })} />
        {controls?.auto_exposure === false && (
          <Slider
            label={en ? "Exposure time" : "Čas expozice"}
            value={controls?.exposure_time_us ?? 10000}
            min={100}
            max={100000}
            step={100}
            fmt={(v) => `${Math.round(v)} µs`}
            on={(v) => setCameraSettings({ exposure_time_us: Math.round(v) })}
          />
        )}
        <Slider
          label={en ? "Exposure value (EV)" : "Kompenzace expozice (EV)"}
          value={controls?.exposure_value ?? 0}
          min={-8}
          max={8}
          step={0.5}
          on={(v) => setCameraSettings({ exposure_value: v })}
        />
        <Slider
          label={en ? "Analogue gain" : "Analogový zisk"}
          value={controls?.analogue_gain ?? 1}
          min={1}
          max={16}
          step={0.5}
          on={(v) => setCameraSettings({ analogue_gain: v })}
        />
      </div>

      {/* --- white balance -------------------------------------------------- */}
      <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.line}`, marginBottom: 8 }}>
        <p style={{ ...eyebrow, margin: "0 0 6px" }}>{en ? "White balance" : "Vyvážení bílé"}</p>
        <Toggle label={en ? "Auto white balance" : "Automatické vyvážení bílé"} value={controls?.auto_white_balance ?? true} on={(v) => setCameraSettings({ auto_white_balance: v })} />
        {controls?.auto_white_balance === false && (
          <Select
            label={en ? "AWB mode" : "Režim AWB"}
            value={controls?.awb_mode ?? "Auto"}
            options={AWB_MODES}
            on={(v) => setCameraSettings({ awb_mode: v })}
          />
        )}
      </div>
    </section>
  );
}
