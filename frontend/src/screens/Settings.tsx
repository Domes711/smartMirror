import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BackButton } from "@/components/shell";
import { Segmented, Toggle, tokens as C, h2, eyebrow } from "@/components/ui";
import { uiActions } from "@/features/ui/uiSlice";
import { settingsActions } from "@/features/settings/settingsSlice";
import * as fx from "@/app/thunks";

export default function Settings() {
  const dispatch = useAppDispatch();
  const { L, lang } = useT();
  const settings = useAppSelector((s) => s.settings);
  const radarActive = useAppSelector((s) => s.dev.radarActive);

  const SettingRow = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "18px 0", borderBottom: `1px solid ${C.line}` }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginTop: 3 }}>{sub}</div>
      </div>
      {children}
    </div>
  );

  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", padding: "18px 22px 0", animation: "scin .28s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <BackButton onClick={() => dispatch(uiActions.closeSettings())}>← {L.back}</BackButton>
        <h2 style={h2}>{L.settings}</h2>
      </div>

      <div className="mc-noscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -22px", padding: "0 22px 28px" }}>
        <p style={{ ...eyebrow, margin: "0 0 4px" }}>{L.setLangHead}</p>
        <SettingRow title={L.setLang} sub={L.setLangSub}>
          <Segmented options={[{ value: "cs", label: "CS" }, { value: "en", label: "EN" }]} value={lang} onChange={(v) => dispatch(uiActions.setLang(v))} />
        </SettingRow>

        <p style={{ ...eyebrow, margin: "18px 0 4px" }}>{L.setMirror}</p>
        <SettingRow title={L.setRadar} sub={L.setRadarSub}>
          <Toggle on={radarActive} onClick={() => dispatch(fx.toggleRadar())} />
        </SettingRow>
        <SettingRow title={L.setFace} sub={L.setFaceSub}>
          <Toggle on={settings.face} onClick={() => dispatch(settingsActions.toggle("face"))} />
        </SettingRow>
        <SettingRow title={L.setNight} sub={L.setNightSub}>
          <Toggle on={settings.night} onClick={() => dispatch(settingsActions.toggle("night"))} />
        </SettingRow>
      </div>
    </section>
  );
}
