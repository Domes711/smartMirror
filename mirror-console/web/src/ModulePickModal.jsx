import { useMemo, useState } from "react";

// Pick a module type from the catalog, fill its config wizard, confirm.
// Fields come from the catalog entry (built-in fields or, for store-installed
// modules, the mm-store.json `wizard`). Confirm is blocked until every required
// field is filled. Returns { type, values } (values coerced by field type).
export default function ModulePickModal({ catalog, position, onCancel, onConfirm }) {
  const [type, setType] = useState(null);
  const [values, setValues] = useState({});

  const entry = useMemo(() => catalog.find((c) => c.type === type), [catalog, type]);
  const fields = entry?.fields || [];
  const filled = (f) => {
    const v = values[f.key];
    if (f.type === "toggle") return true; // a boolean is always "filled"
    return String(v ?? "").trim() !== "";
  };
  const missing = entry ? fields.some((f) => f.required && !filled(f)) : true;

  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }));

  // coerce string inputs to the type the module config expects
  const coerced = () => {
    const out = {};
    for (const f of fields) {
      const raw = values[f.key];
      if (f.type === "toggle") { out[f.key] = !!raw; continue; }
      if (f.type === "number") {
        if (raw !== "" && raw != null) out[f.key] = Number(raw);
        continue;
      }
      if (raw != null && String(raw).trim() !== "") out[f.key] = raw;
    }
    return out;
  };

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
            {fields.length === 0 ? (
              <p className="hint-ok">Tento modul nevyžaduje žádné nastavení.</p>
            ) : (
              fields.map((f) => (
                <WizardField key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
              ))
            )}
            <div className="detail-actions">
              <button className="mqtt-btn compact" onClick={onCancel}>Zrušit</button>
              <button
                className="mqtt-btn k-ok"
                disabled={missing}
                onClick={() => onConfirm({ type: entry.type, values: coerced() })}
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

// One config field rendered per its mm-store wizard `type`.
function WizardField({ field: f, value, onChange }) {
  const label = (
    <span>
      {f.label}
      {f.required ? " *" : ""}
    </span>
  );
  const help = f.help ? <small className="field-help">{f.help}</small> : null;

  if (f.type === "toggle") {
    return (
      <label className="field field-toggle">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {label}
        {help}
      </label>
    );
  }

  if (f.type === "select") {
    return (
      <label className="field">
        {label}
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>— vyber —</option>
          {(f.options || []).map((o) => (
            <option key={String(o.value)} value={o.value}>{o.label}</option>
          ))}
        </select>
        {help}
      </label>
    );
  }

  const inputType =
    f.type === "password" ? "password"
    : f.type === "number" ? "number"
    : f.type === "url" ? "url"
    : "text";
  return (
    <label className="field">
      {label}
      <input
        type={inputType}
        value={value ?? ""}
        placeholder={f.placeholder || ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {help}
    </label>
  );
}
