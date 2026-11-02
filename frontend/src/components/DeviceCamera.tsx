import { useEffect, useRef, useState } from "react";
import { tokens as C } from "@/components/ui";
import { Spinner } from "@/components/shell";

/** Live camera preview + still capture, using THIS device's own camera
 * (getUserMedia) — not the mirror's camera. Used by the new-profile wizard
 * so a phone/laptop browser can enroll face photos directly. */
export function DeviceCamera({ onShot, uploading, L }: { onShot: (blob: Blob) => void; uploading: boolean; L: Record<string, string> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // getUserMedia is only exposed in a secure context (HTTPS, or
    // localhost) — navigator.mediaDevices itself is undefined on plain
    // HTTP against a LAN IP, which is how this app is normally reached.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(L.camDeviceInsecure);
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const shoot = () => {
    const video = videoRef.current;
    if (!video || !ready || uploading) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && onShot(blob), "image/jpeg", 0.9);
  };

  return (
    <div>
      <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", borderRadius: 18, overflow: "hidden", background: "linear-gradient(160deg,#1f1f1b 0%,#14140f 100%)", border: "1px solid #2c2c26", marginBottom: 14 }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
        {error && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 18, textAlign: "center", fontFamily: "var(--mono)", fontSize: 11, color: C.signal }}>
            {L.camDeviceError}: {error}
          </div>
        )}
        {!error && !ready && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: "var(--mono)", fontSize: 11, color: "rgba(233,232,221,.6)" }}>
            {L.camDeviceStarting}
          </div>
        )}
      </div>
      <button onClick={shoot} disabled={!ready || uploading} className="mc-lift" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "14px 18px", cursor: ready && !uploading ? "pointer" : "not-allowed", border: `1px solid ${C.ink}`, background: "transparent", color: ready && !uploading ? C.ink : C.mute, opacity: ready && !uploading ? 1 : 0.6 }}>
        {uploading ? (
          <>
            <Spinner color={C.ink} track={C.line} />
            {L.npUploading}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.7 }}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.4" /></svg>{L.npTakePhoto}
          </>
        )}
      </button>
    </div>
  );
}
