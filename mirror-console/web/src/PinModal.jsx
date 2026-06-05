import { useState } from "react";

// PIN gate for entering developer mode. Asks for a numeric PIN and calls
// onConfirm() when it matches `pin`; otherwise shows an inline error.
export default function PinModal({ pin, onCancel, onConfirm }) {
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);

  const submit = () => {
    if (value === pin) onConfirm();
    else {
      setBad(true);
      setValue("");
    }
  };

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="detail-box ask-box" onClick={(e) => e.stopPropagation()}>
        <strong>Developerský mód</strong>
        <label className="field">
          <span>PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            autoFocus
            onChange={(e) => {
              setValue(e.target.value);
              setBad(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>
        {bad && <span className="hint-bad">Špatný PIN</span>}
        <div className="detail-actions">
          <button className="mqtt-btn compact" onClick={onCancel}>
            Zrušit
          </button>
          <button className="mqtt-btn k-ok" disabled={!value} onClick={submit}>
            Odemknout →
          </button>
        </div>
      </div>
    </div>
  );
}
