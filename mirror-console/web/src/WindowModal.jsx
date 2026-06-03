import { useState } from "react";

// Modal to create a time window: name + from/to time. On confirm returns
// { name, from, to } (HH:MM); the parent persists it and opens the editor.
export default function WindowModal({ onCancel, onConfirm }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("12:00");

  const ok = name.trim() && from && to;

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="detail-box ask-box" onClick={(e) => e.stopPropagation()}>
        <strong>Nové časové okno</strong>
        <label className="field">
          <span>Název</span>
          <input value={name} placeholder="ráno"
            onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="calib-zone">
          <label className="field">
            <span>Od</span>
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>Do</span>
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="detail-actions">
          <button className="mqtt-btn compact" onClick={onCancel}>Zrušit</button>
          <button className="mqtt-btn k-ok" disabled={!ok}
            onClick={() => onConfirm({ name: name.trim(), from, to })}>
            Pokračovat →
          </button>
        </div>
      </div>
    </div>
  );
}
