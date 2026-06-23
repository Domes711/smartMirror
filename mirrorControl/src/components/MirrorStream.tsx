import { useEffect, useRef, useState } from "react";
import { mirrorDisplayUrl } from "@/services/api";

/**
 * Live view of the real mirror: embeds the MagicMirror web page (its own server
 * on :8080), fit (contain) into a height-capped card so the rest of the Home
 * screen (actions + info) stays visible. The mirror renders at a fixed native
 * resolution, so we measure the card and CSS-scale the iframe.
 * Requires MagicMirror `httpHeaders.frameguard:false`.
 */
export function MirrorStream({ nativeW = 1080, nativeH = 1920, height = "48dvh" }: { nativeW?: number; nativeH?: number; height?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [failed, setFailed] = useState(false);
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

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", height, borderRadius: 16, overflow: "hidden", background: "#000", display: "grid", placeItems: "center" }}>
      {!failed && scale > 0 && (
        <iframe
          src={url}
          title="mirror"
          scrolling="no"
          onError={() => setFailed(true)}
          style={{ width: nativeW, height: nativeH, border: "none", transform: `scale(${scale})`, transformOrigin: "center center", pointerEvents: "none" }}
        />
      )}
    </div>
  );
}
