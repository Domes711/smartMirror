// Interactive mirror layout grid. Renders the 11 MagicMirror regions in a
// mirror-shaped box; each region shows its placed modules (with ✕) and a ＋
// button to add one. Positions match MM_POSITIONS in the backend.
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
  top_bar: "top bar",
  top_left: "top left",
  top_center: "top center",
  top_right: "top right",
  upper_third: "upper third",
  middle_center: "middle",
  lower_third: "lower third",
  bottom_left: "bottom left",
  bottom_center: "bottom center",
  bottom_right: "bottom right",
  bottom_bar: "bottom bar",
};

export default function MirrorGrid({ layout, idLabel, onAdd, onRemove }) {
  const at = (pos) => layout.filter((e) => e.position === pos);

  return (
    <div className="mirror">
      {ROWS.map((row, ri) => (
        <div className="mirror-row" key={ri}>
          {row.map((pos) => (
            <div className="cell" key={pos}>
              <span className="cell-pos">{LABELS[pos]}</span>
              <div className="cell-mods">
                {at(pos).map((e) => (
                  <span className="cell-mod" key={e.id}>
                    {idLabel(e.id)}
                    <button className="cell-mod-x" onClick={() => onRemove(e.id, pos)} title="odebrat">
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <button className="cell-add" onClick={() => onAdd(pos)} title="přidat modul">
                ＋
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
