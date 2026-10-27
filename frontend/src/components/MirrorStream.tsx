import { mirrorDisplayUrl } from "@/services/api";

/**
 * Live view of the real mirror: embeds the MagicMirror web page (its own server
 * on :8080) as a full-size iframe.
 * Requires MagicMirror `httpHeaders.frameguard:false`.
 */
export function MirrorStream({ zoom = 0.5 }: { zoom?: number }) {
  const url = mirrorDisplayUrl();

  return (
    <iframe
      src={url}
      title="mirror"
      scrolling="no"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
        zoom: zoom
      }}
    />
  );
}
