import type { MouseEvent } from "react";
import { useAppDispatch } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { Calendar, useSceneCards, HOUR_PX } from "@/components/Calendar";
import { PillButton, tokens as C, h1 } from "@/components/ui";
import * as fx from "@/app/thunks";

export default function Scenes() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const cards = useSceneCards({ onOpen: (id) => dispatch(fx.editScene(id, "scenes")) });

  // tap an empty slot on the calendar → new scene at that hour
  const onCalClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest?.("[data-scene-card]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    let hour = Math.floor((e.clientY - rect.top) / HOUR_PX);
    hour = Math.min(23, Math.max(0, hour));
    dispatch(fx.newSceneFromCal(hour, Math.min(hour + 1, 24)));
  };

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ flex: "0 0 auto", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={h1}>{L.layoutsTitle}</h1>
        <PillButton onClick={() => dispatch(fx.openNewScene())}>
          <span style={{ fontFamily: "var(--grotesk)", fontWeight: 700, marginRight: 6 }}>+</span>
          {L.sceneBtn}
        </PillButton>
      </div>
      <p style={{ flex: "0 0 auto", fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "10px 0 16px" }}>{L.layoutsHint}</p>
      <div id="mc-cal-scroll" className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "2px 22px 28px" }}>
        <Calendar cards={cards} showAllDay onCalClick={onCalClick} />
      </div>
    </section>
  );
}
