import { useCallback, useEffect, useState } from "react";
import ProfileWizard from "./ProfileWizard.jsx";
import LoadingOverlay from "./LoadingOverlay.jsx";

// Profiles are driven by the learned faces: one profile per dataset/<name>/
// folder. Overview (sample photo, name, remove) + the add-profile wizard.
// Richer per-profile settings (module layout, time windows) come later.
export default function ProfilesPanel() {
  const [profiles, setProfiles] = useState(null); // null = loading
  const [busy, setBusy] = useState(null); // name being removed
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);

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

  const remove = useCallback(
    async (name) => {
      if (!window.confirm(`Odebrat profil „${name}"? Smažou se fotky a obličej se přetrénuje.`))
        return;
      setBusy(name);
      setError(null);
      try {
        const r = await fetch(`/profiles?name=${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error || `remove ${r.status}`);
        setProfiles(b.profiles || []);
      } catch (e) {
        setError(`Odebrání selhalo: ${e.message}`);
        load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

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

  return (
    <div className="panel">
      <LoadingOverlay show={!!busy} message={`Odebírám profil a přetrénovávám…`} />

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
            <div key={p.name} className="card profile-card">
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
              <button
                className="mqtt-btn k-warn"
                disabled={busy === p.name}
                onClick={() => remove(p.name)}
              >
                {busy === p.name ? "Odebírám…" : "Odebrat"}
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="profiles-note">
        Brzy: nastavení rozložení modulů a časových oken pro každý profil.
      </p>
    </div>
  );
}
