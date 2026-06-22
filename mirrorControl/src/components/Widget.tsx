import { useAppSelector } from "@/app/hooks";
import { fmod } from "@/data/catalog";

/** Renders a widget's compact mirror representation (preview mode). */
export function Widget({ id }: { id: string }) {
  const time = useAppSelector((s) => s.ui.time);
  const en = useAppSelector((s) => s.ui.lang === "en");

  if (id === "clock") {
    return (
      <div>
        <b style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, display: "block", lineHeight: 1 }}>{time}</b>
        <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#8e8d83" }}>{en ? "Thu 12 Jun" : "čt 12. čer"}</span>
      </div>
    );
  }

  const map: Record<string, [string, string]> = {
    "MMM-Flights": [en ? "✈ Flights" : "✈ Lety", en ? "PRG · 3 departures" : "PRG · 3 odlety"],
    "MMM-Brno-Transit": ["▭ 9 · 3 min", "▢ 67 · 7 min"],
    "MMM-Mail": [en ? "✉ 2 new" : "✉ 2 nové", "Šárka N. · David K."],
    "MMM-Package-Tracker": [en ? "▦ 3 packages" : "▦ 3 balíky", "Amazon · Kosmas"],
    "MMM-HA-Reminders": [en ? "○ 4 reminders" : "○ 4 připomínky", en ? "Call mom · Invoice" : "Zavolat mámě · Faktura"],
    "MMM-Weather": [en ? "☂ 18° rain" : "☂ 18° déšť", en ? "Brno · feels 16°" : "Brno · pocit 16°"],
    "MMM-Calendar": [en ? "▤ 3 events" : "▤ 3 události", en ? "Standup 10:00" : "Standup 10:00"],
  };
  const d = map[id];
  if (!d) return <div style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{fmod(id, en)}</div>;
  return (
    <div style={{ fontFamily: "var(--mono)", fontSize: 11, lineHeight: 1.4 }}>
      <span style={{ color: "#cfcec2" }}>{d[0]}</span>
      <small style={{ display: "block", fontSize: 9, color: "#8e8d83" }}>{d[1]}</small>
    </div>
  );
}
