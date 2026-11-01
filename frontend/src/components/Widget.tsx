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
      </div>
    );
  }

  return <div style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{fmod(id, en)}</div>;
}
