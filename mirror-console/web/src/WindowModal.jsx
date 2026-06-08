import { useState } from "react";

// Modal to create OR edit a time window. Without `initial` it collects
// name + from/to (create). With `initial` ({ name, from, to } in HH:MM) it
// pre-fills the times for editing and locks the name (the name is the window
// key). On confirm returns { name, from, to } (HH:MM); the parent persists it.
export default function WindowModal({ onCancel, onConfirm, initial }) {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [from, setFrom] = useState(initial?.from || "09:00");
  const [to, setTo] = useState(initial?.to || "12:00");

  const ok = (editing || name.trim()) && from && to;

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="detail-box ask-box" onClick={(e) => e.stopPropagation()}>
        <strong>{editing ? "Upravit čas okna" : "Nové časové okno"}</strong>
        <label className="field">
          <span>Název</span>
          <input value={editing ? initial.name : name} placeholder="ráno"
            disabled={editing}
            onChange={(e) => setName(e.target.value)} autoFocus={!editing} />
        </label>
        <div className="calib-zone">
          <label className="field">
            <span>Od</span>
            <input type="time" value={from} autoFocus={editing}
              onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>Do</span>
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="detail-actions">
          <button className="mqtt-btn compact" onClick={onCancel}>Zrušit</button>
          <button className="mqtt-btn k-ok" disabled={!ok}
            onClick={() => onConfirm({ name: editing ? initial.name : name.trim(), from, to })}>
            {editing ? "Uložit čas" : "Pokračovat →"}
          </button>
        </div>
      </div>
    </div>
  );
}
