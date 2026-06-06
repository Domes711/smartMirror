import { useEffect, useRef, useState } from "react";
import "./App.css";
import CameraPanel from "./CameraPanel.jsx";
import ModuleCreator from "./ModuleCreator.jsx";
import MqttPanel from "./MqttPanel.jsx";
import ProfilesPanel from "./ProfilesPanel.jsx";
import ModuleStorePanel from "./ModuleStorePanel.jsx";
import RadarPanel from "./RadarPanel.jsx";
import PinModal from "./PinModal.jsx";

// PIN for developer mode. Override at build time with VITE_DEV_PIN.
const DEV_PIN = import.meta.env.VITE_DEV_PIN || "1234";

// User-facing tabs vs. developer-only tabs. The gear toggles between the two
// sections; entering the developer section is PIN-gated.
const USER_TABS = [
  { id: "profiles", label: "Profily" },
  { id: "store", label: "Obchod modulů" },
];
const DEV_TABS = [
  { id: "camera", label: "Kamera" },
  { id: "radar", label: "Radar" },
  { id: "mqtt", label: "MQTT" },
  { id: "modules", label: "Moduly (AI)" },
];

export default function App() {
  const [dev, setDev] = useState(false);
  const [tab, setTab] = useState("profiles");
  const [askPin, setAskPin] = useState(false);

  const tabs = dev ? DEV_TABS : USER_TABS;

  // Expose the sticky topbar's live height as --topbar-h so panels can pin
  // their own controls directly below it (the topbar wraps on narrow screens,
  // so a fixed offset wouldn't do).
  const appRef = useRef(null);
  const topbarRef = useRef(null);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const update = () =>
      appRef.current?.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // Gear click: enter dev mode (PIN-gated) or leave it (no PIN needed).
  const toggleDev = () => {
    if (dev) {
      setDev(false);
      setTab(USER_TABS[0].id);
    } else {
      setAskPin(true);
    }
  };

  const unlockDev = () => {
    setAskPin(false);
    setDev(true);
    setTab(DEV_TABS[0].id);
  };

  return (
    <div className="app" ref={appRef}>
      <header className="topbar" ref={topbarRef}>
        <h1>Mirror Console{dev && <span className="dev-tag">dev</span>}</h1>
        <nav className="tabs" aria-label="Sekce">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={"tab" + (tab === t.id ? " active" : "")}
              aria-current={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button
            className={"tab gear" + (dev ? " active" : "")}
            aria-pressed={dev}
            title={dev ? "Zpět do běžného režimu" : "Developerský mód"}
            onClick={toggleDev}
          >
            ⚙
          </button>
        </nav>
      </header>

      {tab === "profiles" && <ProfilesPanel />}
      {tab === "store" && <ModuleStorePanel />}
      {tab === "camera" && <CameraPanel />}
      {tab === "radar" && <RadarPanel />}
      {tab === "mqtt" && <MqttPanel />}
      {tab === "modules" && <ModuleCreator />}

      <footer className="footer">smart mirror · konzole</footer>

      {askPin && (
        <PinModal
          pin={DEV_PIN}
          onCancel={() => setAskPin(false)}
          onConfirm={unlockDev}
        />
      )}
    </div>
  );
}
