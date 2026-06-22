import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useT } from "@/i18n/useT";
import { BottomSheet, Segmented, tokens as C, h2, eyebrow } from "@/components/ui";
import { devActions } from "@/features/dev/devSlice";
import { TOPICS, isConnected, resolveMqttUrl } from "@/services/mqtt";
import * as fx from "@/app/thunks";

export default function Comms() {
  const dispatch = useAppDispatch();
  const { L, en } = useT();
  const sent = useAppSelector((s) => s.dev.sentMsgs);
  const name = useAppSelector((s) => s.dev.commsName);
  const panel = useAppSelector((s) => s.dev.commsPanel);
  const connected = isConnected();

  // presets publish to the REAL broker topics used across the repo.
  const presets: { label: string; topic: string; payload: string; dot: string }[] = [
    { label: en ? "Motion detected by radar" : "Pohyb detekován radarem", topic: TOPICS.radarPresence, payload: "present", dot: "#3bd17a" },
    { label: en ? "Absence" : "Nepřítomnost", topic: TOPICS.radarPresence, payload: "absent", dot: "#8C8C81" },
    { label: (en ? "Face recognised: " : "Obličej rozpoznán: ") + name, topic: TOPICS.cameraRecognition, payload: JSON.stringify({ user: name }), dot: "#4aa8ff" },
    { label: en ? "Unknown face" : "Neznámý obličej", topic: TOPICS.cameraRecognition, payload: JSON.stringify({ user: null }), dot: "#ffc34d" },
    { label: en ? "Reset / sleep" : "Reset / uspání", topic: TOPICS.controlReset, payload: "1", dot: "#E5482F" },
    { label: en ? "Wake mirror" : "Probudit zrcadlo", topic: TOPICS.wake, payload: "1", dot: "#E5482F" },
  ];

  const links = [
    { name: "MQTT broker", sub: resolveMqttUrl().replace(/^wss?:\/\//, ""), dot: connected ? C.green : C.signal, stat: connected ? (en ? "connected" : "připojeno") : en ? "offline" : "odpojeno", statColor: connected ? C.green : C.signal },
    { name: "WebSocket", sub: resolveMqttUrl(), dot: connected ? C.green : C.mute, stat: connected ? (en ? "open" : "otevřeno") : en ? "closed" : "zavřeno", statColor: connected ? C.green : C.mute },
    { name: "Home Assistant", sub: "supervisor · 2024.12", dot: C.green, stat: en ? "linked" : "propojeno", statColor: C.green },
    { name: "OTA", sub: en ? "channel · stable" : "kanál · stable", dot: C.mute, stat: en ? "idle" : "nečinné", statColor: C.mute },
  ];

  return (
    <section style={{ padding: "18px 22px 30px", animation: "scin .28s ease" }}>
      <p style={{ ...eyebrow, margin: "0 0 6px" }}>MQTT · WS · {resolveMqttUrl().replace(/^wss?:\/\//, "")}</p>
      <h2 style={{ ...h2, marginBottom: 14 }}>{L.navComms}</h2>

      <button onClick={() => dispatch(devActions.openComms())} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--mono)", fontSize: 13, borderRadius: 999, padding: "16px 18px", cursor: "pointer", border: `1px solid ${C.ink}`, background: C.ink, color: C.paper, marginBottom: 18 }}>
        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: C.paper }}><path d="M3 11l18-8-8 18-2-7-8-3z" /></svg>
        {en ? "Send message" : "Odeslat zprávu"}
      </button>

      {links.map((l) => (
        <div key={l.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 2px", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: l.dot, flex: "0 0 auto" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{l.name}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.mute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.sub}</div>
          </div>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: l.statColor }}>{l.stat}</span>
        </div>
      ))}

      <p style={{ ...eyebrow, margin: "18px 0 8px" }}>{en ? "Message log" : "Záznam zpráv"}</p>
      <div style={{ background: "#0c0d0b", borderRadius: 12, padding: 12, fontFamily: "var(--mono)", fontSize: 10.5, color: "#cfcec2", minHeight: 80 }}>
        {sent.length === 0 && <div style={{ color: "#6f6e66" }}>—</div>}
        {sent.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", whiteSpace: "nowrap", overflow: "hidden" }}>
            <span style={{ color: "#6f6e66" }}>{m.t}</span>
            <span style={{ color: m.dirColor }}>{m.dir}</span>
            <span style={{ color: "#9fd9b0" }}>{m.topic}</span>
            <span style={{ color: "#b9b8ad", overflow: "hidden", textOverflow: "ellipsis" }}>{m.payload}</span>
          </div>
        ))}
      </div>

      <BottomSheet open={panel} onClose={() => dispatch(devActions.closeComms())}>
        <p style={{ ...eyebrow, margin: "0 0 4px" }}>{en ? "Send MQTT message" : "Odeslat MQTT zprávu"}</p>
        <p style={{ fontSize: 13, color: C.ink2, margin: "0 0 14px" }}>{en ? "Presets · publishes to broker" : "Předvolby · odešle na broker"}</p>
        <div style={{ marginBottom: 14 }}>
          <p style={{ ...eyebrow, margin: "0 0 7px" }}>{en ? "Recognised person" : "Rozpoznaná osoba"}</p>
          <Segmented options={["Eliška", "Marek", "Host"].map((n) => ({ value: n, label: n }))} value={name} onChange={(v) => dispatch(devActions.setCommsName(v))} />
        </div>
        {presets.map((p, i) => (
          <button key={i} onClick={() => dispatch(fx.sendMqtt(p.topic, p.payload))} className="mc-lift" style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 11, border: `1px solid ${C.line}`, borderRadius: 12, background: C.p2, padding: "13px 14px", cursor: "pointer", marginBottom: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.dot, flex: "0 0 auto" }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5 }}>{p.label}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: C.mute }}>{p.topic}</span>
            </span>
          </button>
        ))}
      </BottomSheet>
    </section>
  );
}
