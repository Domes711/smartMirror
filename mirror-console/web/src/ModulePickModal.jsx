import { useMemo, useState } from "react";

// Pick a module type from the catalog, fill its required fields, confirm.
// Confirm is blocked until every required field is filled. Returns
// { type, values } to the parent, which creates the instance + placement.
export default function ModulePickModal({ catalog, position, onCancel, onConfirm }) {
  const [type, setType] = useState(null);
  const [values, setValues] = useState({});

  const entry = useMemo(() => catalog.find((c) => c.type === type), [catalog, type]);
  const missing = entry
    ? entry.fields.some((f) => f.required && !String(values[f.key] || "").trim())
    : true;

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
              <button key={c.type} className="modpick-card" onClick={() => { setType(c.type); setValues({}); }}>
                <div className="modpick-thumb">
                  {c.image
                    ? <img src={c.image} alt="" loading="lazy" />
                    : <span className="modpick-thumb-ph">🧩</span>}
                </div>
                <span className="modpick-card-name">{c.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="modpick-chosen">
              <strong>{entry.label}</strong>
              <button className="mqtt-btn compact" onClick={() => setType(null)}>← Jiný modul</button>
            </div>
            {entry.fields.length === 0 ? (
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
