import { useState } from "react";
import "./App.css";
import CameraPanel from "./CameraPanel.jsx";
import ModuleCreator from "./ModuleCreator.jsx";
import MqttPanel from "./MqttPanel.jsx";
import ProfilesPanel from "./ProfilesPanel.jsx";
import RadarPanel from "./RadarPanel.jsx";

const TABS = [
  { id: "camera", label: "Kamera" },
  { id: "profiles", label: "Profily" },
  { id: "radar", label: "Radar" },
  { id: "mqtt", label: "MQTT" },
  { id: "modules", label: "Moduly (AI)" },
];

export default function App() {
  const [tab, setTab] = useState("camera");

  return (
    <div className="app">
      <header className="topbar">
        <h1>Mirror Console</h1>
        <nav className="tabs" aria-label="Sekce">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={"tab" + (tab === t.id ? " active" : "")}
              aria-current={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "camera" && <CameraPanel />}
      {tab === "profiles" && <ProfilesPanel />}
      {tab === "radar" && <RadarPanel />}
      {tab === "mqtt" && <MqttPanel />}
      {tab === "modules" && <ModuleCreator />}

      <footer className="footer">smart mirror · konzole</footer>
    </div>
  );
}
