// Interactive mirror layout grid. Renders the 11 MagicMirror regions in a
// mirror-shaped box; each region shows its placed modules (click to select →
// click a ＋ elsewhere to MOVE it, keeping the same instance id so the mirror
// can reposition it live) and a ＋ to add a new module. ✕ removes.
const ROWS = [
  ["top_bar"],
  ["top_left", "top_center", "top_right"],
  ["upper_third"],
  ["middle_center"],
  ["lower_third"],
  ["bottom_left", "bottom_center", "bottom_right"],
  ["bottom_bar"],
];

const LABELS = {
  top_bar: "top bar", top_left: "top left", top_center: "top center",
  top_right: "top right", upper_third: "upper third", middle_center: "middle",
  lower_third: "lower third", bottom_left: "bottom left",
  bottom_center: "bottom center", bottom_right: "bottom right", bottom_bar: "bottom bar",
};

export default function MirrorGrid({ layout, idLabel, movingId, onCellClick, onSelect, onRemove }) {
  const at = (pos) => layout.filter((e) => e.position === pos);

  return (
    <div className="mirror">
      {movingId && <div className="mirror-hint">Klikni na ＋ v cílové pozici pro přesun „{idLabel(movingId)}"</div>}
      {ROWS.map((row, ri) => (
        <div className="mirror-row" key={ri}>
          {row.map((pos) => (
            <div className="cell" key={pos}>
              <span className="cell-pos">{LABELS[pos]}</span>
              <div className="cell-mods">
                {at(pos).map((e) => (
                  <span
                    key={e.id}
                    className={"cell-mod" + (movingId === e.id ? " sel" : "")}
                    onClick={() => onSelect(e.id)}
                    title="klik = vybrat k přesunu"
                  >
                    {idLabel(e.id)}
                    <button
                      className="cell-mod-x"
                      onClick={(ev) => { ev.stopPropagation(); onRemove(e.id, pos); }}
                      title="odebrat"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <button className="cell-add" onClick={() => onCellClick(pos)}
                title={movingId ? "přesunout sem" : "přidat modul"}>
                ＋
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
