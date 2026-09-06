import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { PillButton, tokens as C, h1 } from "@/components/ui";
import * as fx from "@/app/thunks";
import { resolveActiveId } from "@/app/selectors";
import { useState } from "react";
import { publish, TOPICS } from "@/services/mqtt";

export default function Home() {
  const dispatch = useAppDispatch();
  const { L } = useT();
  const en = useAppSelector((s) => s.ui.lang === "en");
  const scenes = useAppSelector((s) => s.scenes.scenes);
  // re-render on each clock tick so the resolved scene tracks the time of day
  useAppSelector((s) => s.ui.time);
  const connected = useAppSelector((s) => s.mirror.connected);
  const liveData = useAppSelector((s) => s.mirror.live);
  const mirrorLoading = useAppSelector((s) => s.mirror.loading);
  const activeId = resolveActiveId(scenes);
  const sc = scenes[activeId];
  const regions = sc?.regions ?? {};
  const liveCount = Object.values(regions).reduce((n, a) => n + (a?.length || 0), 0);
  const activeName = mirrorLoading ? "…" : sc ? (en && sc.name_en ? sc.name_en : sc.name) : "—";

  // Radar data
  const radarPresence = useAppSelector((s) => s.dev.livePresence);
  const radarTargets = useAppSelector((s) => s.dev.liveTargets);

  // Brightness control
  const [brightness, setBrightness] = useState(50);

  const StatCard = ({
    icon,
    label,
    value,
    valueColor
  }: {
    icon: string;
    label: string;
    value: string | number;
    valueColor?: string;
  }) => (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.line}`,
      borderRadius: 12,
      padding: "16px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 8
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: C.mute,
          textTransform: "uppercase",
          letterSpacing: ".08em"
        }}>
          {label}
        </span>
      </div>
      <div style={{
        fontFamily: "var(--mono)",
        fontSize: 18,
        fontWeight: 600,
        color: valueColor || C.ink,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }}>
        {value}
      </div>
    </div>
  );

  const handleBrightnessChange = (delta: number) => {
    const newBrightness = Math.max(0, Math.min(100, brightness + delta));
    setBrightness(newBrightness);
    publish(TOPICS.displayControl, { command: "brightness", value: newBrightness });
  };

  const handleWakeSleep = () => {
    publish(TOPICS.displayControl, { command: "toggle" });
  };

  return (
    <section style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: "18px 22px 0",
      animation: "scin .28s ease"
    }}>
      <h1 style={{ ...h1, marginBottom: 16, flex: "0 0 auto" }}>{L.navMirror}</h1>

      <div className="mc-noscroll" style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        margin: "0 -22px",
        padding: "0 22px"
      }}>
        {/* Stats Cards - 2x2 grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 20
        }}>
          <StatCard
            icon="📋"
            label={L.activeScene}
            value={activeName}
          />
          <StatCard
            icon="📡"
            label="Radar"
            value={radarPresence === null ? "—" : radarPresence ? `● ${radarTargets.length}` : "○ 0"}
            valueColor={radarPresence ? C.green : C.mute}
          />
          <StatCard
            icon="🧩"
            label={L.modsRunning}
            value={liveCount}
          />
          <StatCard
            icon="🔗"
            label={L.connection}
            value={connected ? (liveData ? L.online : "sync…") : "offline"}
            valueColor={connected ? C.green : C.signal}
          />
        </div>

        {/* Brightness Control */}
        <div style={{
          background: C.bg,
          border: `1px solid ${C.line}`,
          borderRadius: 12,
          padding: "16px 18px",
          marginBottom: 12
        }}>
          <div style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: C.mute,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            marginBottom: 12
          }}>
            💡 {en ? "Brightness" : "Jas displeje"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => handleBrightnessChange(-10)}
              style={{
                background: C.bg,
                border: `1px solid ${C.line}`,
                borderRadius: 8,
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                cursor: "pointer",
                color: C.ink
              }}
            >
              −
            </button>
            <div style={{
              flex: 1,
              textAlign: "center",
              fontFamily: "var(--mono)",
              fontSize: 24,
              fontWeight: 600,
              color: C.ink
            }}>
              {brightness}%
            </div>
            <button
              onClick={() => handleBrightnessChange(10)}
              style={{
                background: C.bg,
                border: `1px solid ${C.line}`,
                borderRadius: 8,
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                cursor: "pointer",
                color: C.ink
              }}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{
        flex: "0 0 auto",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
        margin: "0 -22px",
        padding: "14px 22px calc(env(safe-area-inset-bottom) + 14px)",
        borderTop: `1px solid ${C.line}`
      }}>
        <PillButton full onClick={() => dispatch(fx.editResolved("home"))}>
          {L.editLayout}
        </PillButton>
        <PillButton variant="outline" onClick={handleWakeSleep}>
          {en ? "Wake / Sleep" : "Probudit / Uspat"}
        </PillButton>
      </div>
    </section>
  );
}
