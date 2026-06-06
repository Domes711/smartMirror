import { useCallback, useEffect, useLayoutEffect, useState } from "react";
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

  // Lock the page to the viewport on the profile detail so its header (← Profily
  // / name / Odebrat profil) stays fixed and only the content below scrolls —
  // same behaviour as the module detail. The add-profile wizard keeps normal
  // page scroll.
  useLayoutEffect(() => {
    const app = document.querySelector(".app");
    if (!app) return;
    app.classList.toggle("app-locked", !!detailName && !adding);
    return () => app.classList.remove("app-locked");
  }, [detailName, adding]);

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
      <div className="store-topbar">
        <button className="pill pill-btn" onClick={() => setAdding(true)}>
          ＋ Přidat profil
        </button>
        {error ? (
          <span className="pill pill-bad">● {error}</span>
        ) : (
          <span className="pill">
            {profiles === null ? "● načítám…" : `● ${profiles.length} profilů`}
          </span>
        )}
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
    </div>
  );
}
