import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { tokens as C } from "./ui";

interface Stop {
  name: string;
  lat: number;
  lon: number;
}

/**
 * Full-screen map for picking a public-transport stop. Tiles from OpenStreetMap,
 * stops queried live from the Overpass API for the visible area (the phone has
 * internet). Tapping a stop returns its name — what MMM-Brno-Transit resolves by.
 */
export function StopMap({ initial, onPick, onClose }: { initial?: string; onPick: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [picked, setPicked] = useState<Stop | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(false);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { zoomControl: true, attributionControl: false }).setView([49.1952, 16.608], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    let t: ReturnType<typeof setTimeout>;
    const onMove = () => {
      clearTimeout(t);
      t = setTimeout(() => loadStops(map), 500);
    };
    map.on("moveend", onMove);
    loadStops(map);
    setTimeout(() => map.invalidateSize(), 80);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStops(map: L.Map) {
    if (map.getZoom() < 13) {
      setZoomedOut(true);
      layerRef.current?.clearLayers();
      return;
    }
    setZoomedOut(false);
    const b = map.getBounds();
    const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
    const q =
      `[out:json][timeout:25];(` +
      `node["public_transport"="platform"]["name"](${bbox});` +
      `node["highway"="bus_stop"]["name"](${bbox});` +
      `node["railway"~"tram_stop|halt|station"]["name"](${bbox});` +
      `);out body 400;`;
    setLoading(true);
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q) });
      const data = await res.json();
      const seen = new Set<string>();
      layerRef.current?.clearLayers();
      for (const el of data.elements || []) {
        const name = el.tags?.name;
        if (!name || el.lat == null) continue;
        const k = name.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        const mk = L.circleMarker([el.lat, el.lon], { radius: 6, color: "#fff", weight: 1.5, fillColor: C.signal, fillOpacity: 0.95 });
        mk.bindTooltip(name, { direction: "top", offset: [0, -4] });
        mk.on("click", () => {
          setPicked({ name, lat: el.lat, lon: el.lon });
          mk.openTooltip();
        });
        layerRef.current?.addLayer(mk);
      }
    } catch {
      /* overpass busy / offline — leave the map usable, user can retry by panning */
    }
    setLoading(false);
  }

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 80, background: C.paper, display: "flex", flexDirection: "column", animation: "mc-fade .18s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(14px + env(safe-area-inset-top)) 16px 12px", borderBottom: `1px solid ${C.line}` }}>
        <button onClick={onClose} style={{ border: `1px solid ${C.ink}`, background: "transparent", borderRadius: 999, padding: "8px 14px", fontFamily: "var(--mono)", fontSize: 12, cursor: "pointer", color: C.ink }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: C.mute }}>Vyber zastávku</div>
          <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{picked?.name || initial || "Klepni na zastávku v mapě"}</div>
        </div>
        {loading && <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.mute }}>…</span>}
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={ref} style={{ position: "absolute", inset: 0 }} />
        {zoomedOut && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 500, background: "rgba(26,26,23,.8)", color: C.paper, fontFamily: "var(--mono)", fontSize: 11, padding: "6px 12px", borderRadius: 999 }}>Přibliž mapu pro zobrazení zastávek</div>
        )}
      </div>

      <div style={{ flex: "0 0 auto", padding: "12px 16px calc(14px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.line}`, background: C.paper }}>
        <button
          onClick={() => { if (picked) { onPick(picked.name); onClose(); } }}
          style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 13, borderRadius: 999, padding: "14px 18px", cursor: picked ? "pointer" : "not-allowed", border: "none", background: picked ? C.ink : "#C9C8BD", color: picked ? C.paper : "#8C8C81" }}
        >
          {picked ? `Použít: ${picked.name}` : "Vyber zastávku v mapě"}
        </button>
      </div>
    </div>
  );
}
