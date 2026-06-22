import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BackButton, Spinner } from "@/components/shell";
import { Segmented, Toggle, tokens as C, h2, eyebrow } from "@/components/ui";
import { uiActions } from "@/features/ui/uiSlice";
import { settingsActions } from "@/features/settings/settingsSlice";
import * as fx from "@/app/thunks";

export default function Settings() {
  const dispatch = useAppDispatch();
  const { L, lang } = useT();
  const settings = useAppSelector((s) => s.settings);
  const radarActive = useAppSelector((s) => s.dev.radarActive);
  const conn = useAppSelector((s) => s.dev.connState);
  const scanIp = useAppSelector((s) => s.dev.scanIp);

  const connSub = conn === "scanning" ? L.connScanSub : conn === "found" ? `192.168.1.42 · ${L.online}` : L.connIdleSub;
  const connBtn = conn === "scanning" ? L.connScanning : conn === "found" ? L.connRescan : L.connSearch;

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "18px 0", borderBottom: `1px solid ${C.line}` }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{L.setConn}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: conn === "found" ? C.green : C.mute, marginTop: 3 }}>
              {conn === "scanning" ? scanIp : conn === "found" ? "● " : ""}{connSub}
            </div>
          </div>
          <button onClick={() => dispatch(fx.searchMirror())} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "11px 16px", cursor: "pointer", border: "none", background: conn === "scanning" ? C.p3 : C.ink, color: conn === "scanning" ? C.mute : C.paper }}>
            {conn === "scanning" ? <Spinner color="#8C8C81" track="#D8D7CB" /> : <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>}
            {connBtn}
          </button>
        </div>

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
