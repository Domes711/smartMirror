import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BackButton } from "@/components/shell";
import { PillButton, tokens as C, h2, eyebrow } from "@/components/ui";
import * as fx from "@/app/thunks";

export default function Windows() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const windows = useAppSelector((s) => s.scenes.windows);
  const scenes = useAppSelector((s) => s.scenes.scenes);

  return (
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <BackButton onClick={() => dispatch(fx.nav("home", "home"))}>← {L.navMirror}</BackButton>
        <h2 style={h2}>{L.winTitle}</h2>
      </div>
      <p style={{ ...eyebrow, margin: "0 0 14px" }}>{L.winEyebrow}</p>
      <PillButton variant="outline" full onClick={() => dispatch(fx.addWindow())}>
        <span style={{ fontFamily: "var(--grotesk)", fontWeight: 700, marginRight: 6 }}>+</span>
        {L.addWindow}
      </PillButton>
      <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6, margin: "10px 0 16px" }}>{L.winHint}</p>

      {windows.map((w, i) => {
        const sc = scenes[w.scene];
        const sceneName = sc ? (en && sc.name_en ? sc.name_en : sc.name) : w.scene;
        const mods = sc ? Object.values(sc.regions).flat().length : 0;
        return (
          <div key={i} onClick={() => dispatch(fx.editScene(w.scene, "windows"))} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 2px", borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, width: 108 }}>{w.time}</span>
            <span style={{ color: C.mute }}>→</span>
            <span style={{ border: `1px solid ${C.ink}`, borderRadius: 999, padding: "5px 12px", fontFamily: "var(--mono)", fontSize: 11 }}>{sceneName}</span>
            <span style={{ fontFamily: "var(--mono)", marginLeft: "auto", color: C.mute, fontSize: 11 }}>{mods} wid.</span>
          </div>
        );
      })}

      <PillButton full style={{ marginTop: 20 }} onClick={() => dispatch(fx.applyAndHome())}>{L.applyToMirror}</PillButton>
    </section>
  );
}
