import { useEffect, useRef, useState } from "react";
import { mirrorDisplayUrl, mirrorStreamUrl } from "@/services/api";

/**
 * Live view of the real mirror.
 *
 * Primary path is an MJPEG **screencast of the physical mirror's own Electron
 * window** (`/mirror.mjpg`, supervisor → CDP). That is the actual screen: the
 * same pixels, the same profile state, the same layout the mirror resolved.
 *
 * The fallback embeds MagicMirror's web server (:8080) in an iframe. That is a
 * *second, independent* client — it re-renders the page from scratch — so it is
 * only used when the screencast is unavailable (MagicMirror started without
 * --remote-debugging-port, or an older backend). It needs the mirror to be
 * reachable on :8080 and `httpHeaders.xFrameOptions:false`.
 */
export function MirrorStream({ nativeW = 1080, nativeH = 1920, height = "48dvh" }: { nativeW?: number; nativeH?: number; height?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  // "stream" = real screencast, "iframe" = re-rendered :8080 page (fallback)
  const [source, setSource] = useState<"stream" | "iframe">("stream");
  // Bumped to force the <img> to reconnect after a dropped stream.
  const [attempt, setAttempt] = useState(0);
  const url = mirrorDisplayUrl();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.min(el.clientWidth / nativeW, el.clientHeight / nativeH));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nativeW, nativeH]);

  // The supervisor ends the MJPEG response when the mirror stops producing
  // frames; retry a couple of times (the mirror may just be restarting under
  // pm2) before falling back to the iframe.
  const onStreamError = () => {
    setAttempt((n) => {
      if (n >= 2) setSource("iframe");
      return n + 1;
    });
  };

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", height, borderRadius: 16, overflow: "hidden", background: "#000", display: "grid", placeItems: "center" }}>
      {source === "stream" && (
        <img
          key={attempt}
          src={`${mirrorStreamUrl()}?v=${attempt}`}
          alt="mirror"
          onError={onStreamError}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
        />
      )}
      {source === "iframe" && scale > 0 && (
        <iframe
          src={url}
          title="mirror"
          scrolling="no"
          style={{ width: nativeW, height: nativeH, border: "none", transform: `scale(${scale})`, transformOrigin: "center center", pointerEvents: "none" }}
        />
      )}
    </div>
  );
}
