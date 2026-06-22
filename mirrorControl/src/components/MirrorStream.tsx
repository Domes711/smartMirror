import { useEffect, useRef, useState } from "react";
import { mirrorDisplayUrl } from "@/services/api";

/**
 * Live view of the real mirror: embeds the MagicMirror web page (its own
 * server on :8080) and scales it to fit the preview card. The mirror renders
 * at a fixed native resolution, so we measure the container and CSS-scale the
 * iframe (transform). Requires MagicMirror `httpHeaders.frameguard:false`.
 */
export function MirrorStream({ nativeW = 1080, nativeH = 1920 }: { nativeW?: number; nativeH?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [failed, setFailed] = useState(false);
  const url = mirrorDisplayUrl();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / nativeW);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nativeW]);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", aspectRatio: `${nativeW} / ${nativeH}`, borderRadius: 16, overflow: "hidden", background: "#000" }}>
      {!failed && scale > 0 && (
        <iframe
          src={url}
          title="mirror"
          scrolling="no"
          onError={() => setFailed(true)}
          style={{ position: "absolute", top: 0, left: 0, width: nativeW, height: nativeH, border: "none", transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }}
        />
      )}
    </div>
  );
}
