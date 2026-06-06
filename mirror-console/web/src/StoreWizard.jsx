// Typed config form generated from a module's `wizard` metadata
// (store/modules/<name>/mm-store.json → localized by the backend).
//
// Renders one input per field by `type` (text | password | number | select |
// toggle | url), with an optional help line. Presentational: the parent owns
// `values` and gets updates via `onChange(key, value)`. Use `wizardMissing`
// to gate a submit button on required fields.

export function wizardMissing(wizard, values) {
  return (wizard || []).some(
    (f) => f.required && !String(values[f.key] ?? "").trim()
  );
}

export default function StoreWizard({ wizard, values, onChange }) {
  if (!wizard || wizard.length === 0) {
    return <p className="hint-ok">Tento modul nevyžaduje žádné nastavení.</p>;
  }
  return (
    <div className="store-wizard">
      {wizard.map((f) => (
        <Field key={f.key} field={f} value={values[f.key]} onChange={onChange} />
      ))}
    </div>
  );
}

function Field({ field: f, value, onChange }) {
  const set = (v) => onChange(f.key, v);
  const dflt = f.default;
  const v = value ?? (f.type === "toggle" ? !!dflt : dflt ?? "");

  if (f.type === "toggle") {
    return (
      <label className="field field-toggle">
        <span className="store-wizard-label">
          <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />
          {f.label}
        </span>
        {f.help && <small className="store-wizard-help">{f.help}</small>}
      </label>
    );
  }

  return (
    <label className="field">
      <span className="store-wizard-label">
        {f.label}
        {f.required ? " *" : ""}
      </span>
      {f.type === "select" ? (
        <select value={v} onChange={(e) => set(e.target.value)}>
          {!f.required && <option value="">—</option>}
          {(f.options || []).map((o) => (
            <option key={String(o.value)} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
          inputMode={f.type === "url" ? "url" : undefined}
          value={v}
          placeholder={f.placeholder || ""}
          onChange={(e) => set(e.target.value)}
        />
      )}
      {f.help && <small className="store-wizard-help">{f.help}</small>}
    </label>
  );
}
