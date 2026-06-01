import { useCallback, useEffect, useState } from "react";
import ProfileWizard from "./ProfileWizard.jsx";
import ProfileDetail from "./ProfileDetail.jsx";

// Profiles are driven by the learned faces: one profile per dataset/<name>/.
// Overview grid → click a card to open its detail; ＋ Přidat profil → wizard.
export default function ProfilesPanel() {
  const [profiles, setProfiles] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [detailName, setDetailName] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/profiles");
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || `profiles ${r.status}`);
      setProfiles(b.profiles || []);
      setError(null);
    } catch (e) {
      setError(e.message);
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (adding) {
    return (
      <ProfileWizard
        existing={(profiles || []).map((p) => p.name)}
        onClose={(created) => {
          setAdding(false);
          if (created) load();
        }}
      />
    );
  }

  if (detailName) {
    return (
      <ProfileDetail
        name={detailName}
        onBack={() => {
          setDetailName(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        {error ? (
          <span className="pill pill-bad">● {error}</span>
        ) : (
          <span className="pill">
            {profiles === null ? "● načítám…" : `● ${profiles.length} profilů`}
          </span>
        )}
      </div>

      <div className="panel-actions">
        <button className="mqtt-btn k-ok" onClick={() => setAdding(true)}>
          ＋ Přidat profil
        </button>
      </div>

      {profiles && profiles.length === 0 ? (
        <div className="card status-card">
          <div className="status-icon">👤</div>
          <h2>Žádné profily</h2>
          <p>
            Profily vznikají z naučených obličejů. Klikni na{" "}
            <strong>＋ Přidat profil</strong> a vytvoř první.
          </p>
        </div>
      ) : (
        <div className="profiles">
          {(profiles || []).map((p) => (
            <button
              key={p.name}
              className="card profile-card clickable"
              onClick={() => setDetailName(p.name)}
            >
              <div className="profile-photo">
                <img
                  src={`/photo?name=${encodeURIComponent(p.name)}&file=${encodeURIComponent(p.sample)}`}
                  alt={p.name}
                />
              </div>
              <div className="profile-body">
                <h3>{p.name}</h3>
                <span className="profile-meta">{p.count} fotek</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="profiles-note">
        Klikni na profil pro detail. Brzy: rozložení modulů a časová okna.
      </p>
    </div>
  );
}
