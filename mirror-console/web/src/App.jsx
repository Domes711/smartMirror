import { useState } from "react";
import "./App.css";
import CameraPanel from "./CameraPanel.jsx";
import MqttPanel from "./MqttPanel.jsx";

const TABS = [
  { id: "camera", label: "Kamera" },
  { id: "mqtt", label: "MQTT" },
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

      {tab === "camera" ? <CameraPanel /> : <MqttPanel />}

      <footer className="footer">smart mirror · konzole</footer>
    </div>
  );
}
