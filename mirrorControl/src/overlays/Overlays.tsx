import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { Modal, BottomSheet, tokens as C } from "@/components/ui";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { modulesActions } from "@/features/modules/modulesSlice";
import { profilesActions } from "@/features/profiles/profilesSlice";
import { devActions } from "@/features/dev/devSlice";
import { REGIONS, fmod } from "@/data/catalog";
import * as fx from "@/app/thunks";
import { SearchOverlay } from "./SearchOverlay";
import type { RegionId } from "@/types";

export function Overlays() {
  return (
    <>
      <PwModal />
      <NewSceneModal />
      <TimeEditModal />
      <DelSceneModal />
      <EditBackModal />
      <UninstallModal />
      <DeleteModModal />
      <ZoneSheet />
      <ConfigModal />
      <PhotoSheet />
      <PhotoDelModal />
      <ProfileDelModal />
      <NpSheet />
      <SearchOverlay />
    </>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>{children}</h3>;
}
function Body({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13.5, lineHeight: 1.55, color: C.ink2, margin: "0 0 18px" }}>{children}</p>;
}
function Actions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 10 }}>{children}</div>;
}
const cancelBtn = (onClick: () => void, label: string) => (
  <button onClick={onClick} style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "12px 18px", cursor: "pointer", border: `1px solid ${C.line}`, background: "transparent", color: C.ink }}>{label}</button>
);
const dangerBtn = (onClick: () => void, label: string) => (
  <button onClick={onClick} style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "12px 18px", cursor: "pointer", border: `1px solid ${C.signal}`, background: C.signal, color: "#fff" }}>{label}</button>
);
const solidBtn = (onClick: () => void, label: string, enabled = true) => (
  <button onClick={enabled ? onClick : undefined} style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "12px 18px", cursor: enabled ? "pointer" : "not-allowed", border: "none", background: enabled ? C.ink : "#C9C8BD", color: enabled ? C.paper : "#8C8C81" }}>{label}</button>
);

/* ---------- dev password ---------- */
function PwModal() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const { pwModal, pwInput, pwError } = useAppSelector((s) => s.dev);
  return (
    <Modal open={pwModal} onClose={() => dispatch(devActions.closePw())} width={300}>
      <p style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute, margin: "0 0 6px" }}>{L.devEyebrow}</p>
      <Title>{L.devTitle}</Title>
      <input
        autoFocus
        type="password"
        value={pwInput}
        onChange={(e) => dispatch(devActions.setPwInput(e.target.value))}
        onKeyDown={(e) => { if (e.key === "Enter") dispatch(fx.pwSubmit()); }}
        style={{ width: "100%", textAlign: "center", letterSpacing: ".3em", background: C.p3, border: `1px solid ${pwError ? C.signal : C.line}`, borderRadius: 12, padding: "13px 14px", fontSize: 18, color: C.ink, marginBottom: pwError ? 8 : 16 }}
      />
      {pwError && <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.signal, margin: "0 0 14px" }}>{L.devWrong}</p>}
      <Actions>
        {cancelBtn(() => dispatch(devActions.closePw()), L.cancel)}
        {solidBtn(() => dispatch(fx.pwSubmit()), L.devUnlock)}
      </Actions>
    </Modal>
  );
}

/* ---------- new scene ---------- */
function NewSceneModal() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const s = useAppSelector((st) => st.scenes);
  if (!s.newSceneModal) return null;

  const busy: [number, number][] = [];
  for (const id of Object.keys(s.scenes)) {
    const sc = s.scenes[id];
    if (!sc.scheduled || /^default/i.test(sc.use || "")) continue;
    busy.push([sc.startH ?? 0, sc.endH ?? 24]);
  }
  const startBlocked = (h: number) => busy.some((iv) => h >= iv[0] && h < iv[1]);
  let endLimit = 24;
  for (const iv of busy) if (iv[0] >= s.nsStart && iv[0] < endLimit) endLimit = iv[0];
  const conflict = s.nsNoSlot || s.nsEnd <= s.nsStart || busy.some((iv) => s.nsStart < iv[1] && iv[0] < s.nsEnd);

  const onStart = (st: number) => {
    let m = 24;
    for (const iv of busy) if (iv[0] >= st && iv[0] < m) m = iv[0];
    let end = s.nsEnd;
    if (end <= st || end > m) end = st + Math.min(2, m - st);
    if (end <= st) end = st + 1;
    dispatch(scenesActions.setNsRange({ start: st, end }));
  };

  return (
    <Modal open onClose={() => dispatch(scenesActions.closeNewScene())}>
      <Title>{L.nsTitle}</Title>
      <label style={lbl}>{L.nsNameLabel}</label>
      <input value={s.nsName} onChange={(e) => dispatch(scenesActions.setNsName(e.target.value))} placeholder={L.nsNamePh} style={fld} />
      <label style={lbl}>{L.nsTimeLabel}</label>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <Select label={L.nsFrom} value={s.nsStart} onChange={onStart} options={Array.from({ length: 24 }, (_, h) => ({ v: h, label: `${String(h).padStart(2, "0")}:00`, disabled: startBlocked(h) }))} />
        <Select label={L.nsTo} value={s.nsEnd} onChange={(v) => dispatch(scenesActions.setNsEnd(v))} options={Array.from({ length: 24 }, (_, i) => i + 1).map((h) => ({ v: h, label: `${String(h).padStart(2, "0")}:00`, disabled: h <= s.nsStart || h > endLimit }))} />
      </div>
      {conflict && !s.nsNoSlot && <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.signal, margin: "0 0 12px" }}>{L.nsOverlap}</p>}
      <Actions>
        {cancelBtn(() => dispatch(scenesActions.closeNewScene()), L.cancel)}
        {solidBtn(() => dispatch(fx.createScene()), L.nsCreate, !conflict)}
      </Actions>
    </Modal>
  );
}

/* ---------- time edit ---------- */
function TimeEditModal() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const s = useAppSelector((st) => st.scenes);
  if (!s.timeEditOpen) return null;
  const invalid = s.teEnd <= s.teStart;
  return (
    <Modal open onClose={() => dispatch(scenesActions.closeTimeEdit())}>
      <Title>{L.teTitle}</Title>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <Select label={L.nsFrom} value={s.teStart} onChange={(v) => dispatch(scenesActions.setTeStart(v))} options={Array.from({ length: 24 }, (_, h) => ({ v: h, label: `${String(h).padStart(2, "0")}:00` }))} />
        <Select label={L.nsTo} value={s.teEnd} onChange={(v) => dispatch(scenesActions.setTeEnd(v))} options={Array.from({ length: 24 }, (_, h) => ({ v: h + 1, label: `${String(h + 1).padStart(2, "0")}:00` }))} />
      </div>
      {invalid && <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.signal, margin: "0 0 12px" }}>{L.teInvalidMsg}</p>}
      <Actions>
        {cancelBtn(() => dispatch(scenesActions.closeTimeEdit()), L.cancel)}
        {solidBtn(() => dispatch(scenesActions.saveTimeEdit()), L.teSave, !invalid)}
      </Actions>
    </Modal>
  );
}

/* ---------- delete scene ---------- */
function DelSceneModal() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const open = useAppSelector((s) => s.scenes.delModal);
  const editing = useAppSelector((s) => s.scenes.editing);
  const scenes = useAppSelector((s) => s.scenes.scenes);
  const name = editing && scenes[editing] ? (en && scenes[editing].name_en ? scenes[editing].name_en : scenes[editing].name) : "";
  return (
    <Modal open={open} onClose={() => dispatch(scenesActions.closeDelModal())}>
      <Title>{L.delConfirmTitle}</Title>
      <Body>„{name}" {L.delConfirmB}</Body>
      <Actions>
        {cancelBtn(() => dispatch(scenesActions.closeDelModal()), L.cancel)}
        {dangerBtn(() => dispatch(fx.confirmDelScene()), L.del)}
      </Actions>
    </Modal>
  );
}

/* ---------- unsaved changes ---------- */
function EditBackModal() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const open = useAppSelector((s) => s.scenes.editBackModal);
  return (
    <Modal open={open} onClose={() => dispatch(scenesActions.closeEditBack())}>
      <Title>{L.ebTitle}</Title>
      <Body>{L.ebMsg}</Body>
      <Actions>
        <button onClick={() => dispatch(fx.discardAndBack())} style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "12px 18px", cursor: "pointer", border: `1px solid ${C.signal}`, background: "transparent", color: C.signal }}>{L.ebDiscard}</button>
        {solidBtn(() => dispatch(fx.saveSceneAndBack()), L.ebSave)}
      </Actions>
    </Modal>
  );
}

/* ---------- uninstall ---------- */
function UninstallModal() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const name = useAppSelector((s) => s.modules.uninstallModal);
  const label = name ? fmod(name, en) : "";
  return (
    <Modal open={!!name} onClose={() => dispatch(modulesActions.closeUninstall())}>
      <Title>{L.unConfirmTitle}</Title>
      <Body>„{label}" {L.unConfirmB}</Body>
      <Actions>
        {cancelBtn(() => dispatch(modulesActions.closeUninstall()), L.cancel)}
        {dangerBtn(() => dispatch(fx.confirmUninstall()), L.uninstall)}
      </Actions>
    </Modal>
  );
}

/* ---------- delete own widget ---------- */
function DeleteModModal() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const name = useAppSelector((s) => s.modules.deleteModModal);
  const label = name ? fmod(name, en) : "";
  return (
    <Modal open={!!name} onClose={() => dispatch(modulesActions.closeDeleteMod())}>
      <Title>{L.delModTitle}</Title>
      <Body>„{label}" {L.delModB} {L.delModWarn}</Body>
      <Actions>
        {cancelBtn(() => dispatch(modulesActions.closeDeleteMod()), L.cancel)}
        {dangerBtn(() => dispatch(fx.confirmDeleteMod()), L.delModBtn)}
      </Actions>
    </Modal>
  );
}

/* ---------- zone bottom sheet ---------- */
function ZoneSheet() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const s = useAppSelector((st) => st.scenes);
  const installed = useAppSelector((st) => st.modules.installed);
  const catalogEntries = useAppSelector((st) => st.mirror.catalogEntries);
  const label = (id: string) => catalogEntries.find((c) => c.type === id)?.label || fmod(id, en);
  const rid = s.zoneOpen as RegionId | null;
  if (!rid || !s.editing) return null;
  const reg = s.scenes[s.editing].regions[rid] || [];
  const rdef = REGIONS.find((r) => r.id === rid);
  const usedSet = new Set(Object.values(s.scenes[s.editing].regions).flat() as string[]);
  const addable = installed.filter((m) => !usedSet.has(m));

  return (
    <BottomSheet open onClose={() => dispatch(scenesActions.closeZone())}>
      <p style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute, margin: "0 0 4px" }}>{L.zoneEyebrow}</p>
      <Title>{rdef ? (en ? rdef.label : rdef.cs) : rid}</Title>

      {reg.length > 0 ? (
        <>
          <p style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: C.mute, margin: "6px 0 8px" }}>{L.zoneOrder}</p>
          {reg.map((m, i) => (
            <div key={m} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, width: 22 }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ flex: 1, fontSize: 14 }}>{label(m)}</span>
              <button onClick={() => dispatch(scenesActions.moveModInZone({ rid, idx: i, dir: -1 }))} style={arrowBtn(i === 0)}>↑</button>
              <button onClick={() => dispatch(scenesActions.moveModInZone({ rid, idx: i, dir: 1 }))} style={arrowBtn(i === reg.length - 1)}>↓</button>
              <button onClick={() => dispatch(scenesActions.removeMod({ rid, mod: m }))} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.signal, fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </>
      ) : (
        <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: C.mute, margin: "4px 0 12px" }}>{L.zoneEmptyMsg}</p>
      )}

      <p style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute, margin: "16px 0 8px" }}>{L.zoneAddTitle}</p>
      {addable.length === 0 ? (
        <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: C.mute }}>{L.zoneAllUsedMsg}</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {addable.map((m) => (
            <button key={m} onClick={() => dispatch(fx.addModToZone(rid, m))} style={{ fontFamily: "var(--mono)", fontSize: 11, border: `1px solid ${C.line}`, borderRadius: 999, padding: "8px 13px", cursor: "pointer", background: "transparent", color: C.ink }}>+ {label(m)}</button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

/* ---------- required-config modal (adding a new instance) ---------- */
function ConfigModal() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const open = useAppSelector((s) => s.scenes.cfgOpen);
  const type = useAppSelector((s) => s.scenes.cfgType);
  const values = useAppSelector((s) => s.scenes.cfgValues);
  const entry = useAppSelector((s) => s.mirror.catalogEntries.find((c) => c.type === type));
  if (!open || !type || !entry) return null;
  const fields = entry.fields || [];
  const missing = fields.some((f) => f.required && !(values[f.key] || "").trim());

  return (
    <Modal open onClose={() => dispatch(scenesActions.closeCfgModal())}>
      <p style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute, margin: "0 0 4px" }}>{L.cfgTitle}</p>
      <Title>{entry.label || type}</Title>
      <p style={{ fontSize: 13, lineHeight: 1.5, color: C.ink2, margin: "0 0 16px" }}>{L.cfgHint}</p>
      {fields.map((f) => {
        const v = values[f.key] ?? "";
        const set = (val: string) => dispatch(scenesActions.setCfgValue({ key: f.key, value: val }));
        return (
          <div key={f.key} style={{ marginBottom: 13 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 6 }}>
              {f.label || f.key}
              {f.required && <span style={{ fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase", color: C.signal, border: `1px solid ${C.signal}`, borderRadius: 999, padding: "1px 7px" }}>{L.cfgReq}</span>}
            </label>
            {f.options && f.options.length ? (
              <select value={v} onChange={(e) => set(e.target.value)} style={{ ...fld, marginBottom: 0 }}>
                <option value="" disabled>—</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                value={v}
                onChange={(e) => set(e.target.value)}
                placeholder={f.placeholder || ""}
                type={f.type === "number" ? "number" : "text"}
                style={{ ...fld, marginBottom: 0, borderColor: f.required && !v.trim() ? C.line : C.line }}
              />
            )}
            {f.help && <p style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.mute, margin: "5px 0 0" }}>{f.help}</p>}
          </div>
        );
      })}
      <Actions>
        {cancelBtn(() => dispatch(scenesActions.closeCfgModal()), L.cancel)}
        {solidBtn(() => dispatch(fx.submitCfg()), L.cfgAdd, !missing)}
      </Actions>
    </Modal>
  );
}

/* ---------- photo sheet ---------- */
function PhotoSheet() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const id = useAppSelector((s) => s.profiles.photoSheet);
  const photo = useAppSelector((s) => s.profiles.facePhotos.find((p) => p.id === id));
  if (!photo) return null;
  const date = (() => {
    const d = new Date(2026, 5, 13);
    d.setDate(d.getDate() - photo.n * 2);
    return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
  })();
  return (
    <BottomSheet open onClose={() => dispatch(profilesActions.closePhotoSheet())}>
      <div style={{ width: "100%", aspectRatio: "1 / 1", maxHeight: 240, borderRadius: 16, overflow: "hidden", background: `linear-gradient(150deg, hsl(${photo.hue},34%,64%), hsl(${(photo.hue + 38) % 360},40%,40%))`, marginBottom: 14 }}>
        {photo.src && <img src={photo.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontFamily: "var(--mono)", fontSize: 12 }}>
        <span><b>{L.photoWord} {photo.n}</b><span style={{ color: C.mute }}> · {date}</span></span>
        <span style={{ color: C.mute }}>1080×1080</span>
      </div>
      <button onClick={() => dispatch(profilesActions.openPhotoDel(photo.id))} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "12px 18px", cursor: "pointer", border: `1px solid ${C.signal}`, background: "transparent", color: C.signal }}>
        <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /></svg>
        {L.removePhoto}
      </button>
    </BottomSheet>
  );
}

function PhotoDelModal() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const id = useAppSelector((s) => s.profiles.photoDelModal);
  const photo = useAppSelector((s) => s.profiles.facePhotos.find((p) => p.id === id));
  return (
    <Modal open={!!photo} onClose={() => dispatch(profilesActions.closePhotoDel())}>
      <Title>{L.photoDelTitle}</Title>
      <Body>{photo ? `${L.photoWord} ${photo.n} ` : ""}{L.photoDelMsg}</Body>
      <Actions>
        {cancelBtn(() => dispatch(profilesActions.closePhotoDel()), L.cancel)}
        {dangerBtn(() => dispatch(fx.confirmDeletePhoto()), L.removePhoto)}
      </Actions>
    </Modal>
  );
}

function ProfileDelModal() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const open = useAppSelector((s) => s.profiles.profileDelOpen);
  const name = useAppSelector((s) => s.profiles.profileName);
  return (
    <Modal open={open} onClose={() => dispatch(profilesActions.closeProfileDel())}>
      <Title>{L.deleteProfileTitle}</Title>
      <Body>„{name}" {L.delProfB}</Body>
      <Actions>
        {cancelBtn(() => dispatch(profilesActions.closeProfileDel()), L.cancel)}
        {dangerBtn(() => dispatch(fx.confirmDeleteProfile()), L.deleteProfileBtn)}
      </Actions>
    </Modal>
  );
}

/* ---------- new-profile capture sheet ---------- */
function NpSheet() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const open = useAppSelector((s) => s.profiles.npSheet && s.ui.screen === "newprofile");
  const source = useAppSelector((s) => s.profiles.npSource);
  if (!open) return null;
  return (
    <BottomSheet open onClose={() => dispatch(profilesActions.npCloseSheet())}>
      <Title>{source === "phone" ? L.srcPhoneTitle : L.srcMirrorTitle}</Title>
      <button onClick={() => { dispatch(profilesActions.npShoot()); }} style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "13px 18px", cursor: "pointer", border: `1px solid ${C.ink}`, background: C.ink, color: C.paper, marginBottom: 10 }}>{L.npTakePhoto}</button>
      <button onClick={() => dispatch(profilesActions.npCloseSheet())} style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 12, borderRadius: 999, padding: "13px 18px", cursor: "pointer", border: `1px solid ${C.line}`, background: "transparent", color: C.ink }}>{L.npSheetDone}</button>
    </BottomSheet>
  );
}

/* ---------- helpers ---------- */
const lbl: React.CSSProperties = { display: "block", fontFamily: "var(--mono)", fontSize: 11, color: C.mute, marginBottom: 7, textTransform: "uppercase", letterSpacing: ".08em" };
const fld: React.CSSProperties = { width: "100%", background: C.p3, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", fontSize: 14, color: C.ink, marginBottom: 14 };
function arrowBtn(disabled: boolean): React.CSSProperties {
  return { border: `1px solid ${disabled ? C.line : C.ink}`, background: "transparent", color: disabled ? C.line : C.ink, borderRadius: 8, width: 28, height: 28, cursor: disabled ? "default" : "pointer", fontSize: 13 };
}

function Select({ label, value, onChange, options }: { label: string; value: number; onChange: (v: number) => void; options: { v: number; label: string; disabled?: boolean }[] }) {
  return (
    <label style={{ flex: 1 }}>
      <span style={{ display: "block", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: C.mute, marginBottom: 5 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))} style={{ width: "100%", background: C.p3, border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 10px", fontFamily: "var(--mono)", fontSize: 13, color: C.ink }}>
        {options.map((o) => <option key={o.v} value={o.v} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </label>
  );
}
