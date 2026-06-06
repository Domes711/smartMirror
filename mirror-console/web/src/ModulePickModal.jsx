import { useMemo, useState } from "react";
import StoreWizard, { wizardMissing } from "./StoreWizard.jsx";

// Pick a module type from the catalog, fill its required config, confirm.
// Prefers the curated typed `wizard` (from store/modules/<name>/mm-store.json)
// and falls back to the legacy `fields`. Confirm is blocked until every
// required field is filled. Returns { type, values } to the parent.
export default function ModulePickModal({ catalog, position, onCancel, onConfirm }) {
  const [type, setType] = useState(null);
  const [values, setValues] = useState({});

  const entry = useMemo(() => catalog.find((c) => c.type === type), [catalog, type]);
  const wizard = entry?.wizard;
  const missing = !entry
    ? true
    : wizard
      ? wizardMissing(wizard, values)
      : entry.fields.some((f) => f.required && !String(values[f.key] || "").trim());

  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="detail-box modpick" onClick={(e) => e.stopPropagation()}>
        <div className="modpick-head">
          <strong>Přidat modul</strong>
          <span className="topic">pozice: {position}</span>
        </div>

        {!entry ? (
          <div className="modpick-list">
            {catalog.map((c) => (
              <button key={c.type} className="mqtt-btn" onClick={() => { setType(c.type); setValues({}); }}>
                {c.label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="modpick-chosen">
              <strong>{entry.label}</strong>
              <button className="mqtt-btn compact" onClick={() => setType(null)}>← Jiný modul</button>
            </div>
            {wizard ? (
              <StoreWizard wizard={wizard} values={values} onChange={set} />
            ) : entry.fields.length === 0 ? (
              <p className="hint-ok">Tento modul nevyžaduje žádné nastavení.</p>
            ) : (
              entry.fields.map((f) => (
                <label className="field" key={f.key}>
                  <span>
                    {f.label}
                    {f.required ? " *" : ""}
                  </span>
                  <input
                    value={values[f.key] || ""}
                    placeholder={f.placeholder || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                </label>
              ))
            )}
            <div className="detail-actions">
              <button className="mqtt-btn compact" onClick={onCancel}>Zrušit</button>
              <button
                className="mqtt-btn k-ok"
                disabled={missing}
                onClick={() => onConfirm({ type: entry.type, values })}
              >
                Přidat
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
