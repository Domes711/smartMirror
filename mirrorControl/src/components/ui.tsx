import type { CSSProperties, ReactNode } from "react";

export const tokens = {
  paper: "#E9E8DD", p2: "#EFEEE4", p3: "#E2E1D5", ink: "#1A1A17", ink2: "#3a3a34",
  mute: "#8C8C81", line: "#CFCEC2", signal: "#E5482F", butter: "#ffc34d", bsoft: "#ffe6b3",
  bline: "#f0ad33", bink: "#6B6212", green: "#3b8a4f",
};

const C = tokens;

/** iOS-style pill toggle (track + knob). */
export function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 48, height: 28, flex: "0 0 auto", borderRadius: 999,
        border: `1px solid ${on ? C.ink : C.line}`, background: on ? C.ink : C.p3,
        position: "relative", cursor: "pointer", transition: ".18s", padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute", top: 2, left: on ? 22 : 2, width: 22, height: 22,
          borderRadius: "50%", background: on ? C.paper : C.ink, transition: ".18s",
        }}
      />
    </button>
  );
}

export interface SegOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/** Pill segmented control. */
export function Segmented<T extends string | number>({
  options, value, onChange, size = "md",
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "7px 14px" : "8px 14px";
  return (
    <div style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 999, overflow: "hidden", width: "fit-content" }}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            style={{
              border: "none", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11, padding: pad,
              background: sel ? C.ink : "transparent", color: sel ? C.paper : C.mute, transition: ".15s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Full-bleed dimmed backdrop. */
export function Backdrop({ onClick, children, align = "center" }: { onClick?: () => void; children: ReactNode; align?: "center" | "end" }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "absolute", inset: 0, zIndex: 40, background: "rgba(26,26,23,.42)",
        display: "flex", alignItems: align === "end" ? "flex-end" : "center", justifyContent: "center",
        padding: align === "end" ? 0 : 20, animation: "mc-fade .2s ease",
      }}
    >
      {children}
    </div>
  );
}

/** Centered confirm/form modal card. */
export function Modal({ open, onClose, children, width = 320 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <Backdrop onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width, maxWidth: "100%", background: C.paper, border: `1px solid ${C.line}`, borderRadius: 18, padding: 20, animation: "scin .22s ease" }}
      >
        {children}
      </div>
    </Backdrop>
  );
}

/** Bottom sheet. */
export function BottomSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <Backdrop onClick={onClose} align="end">
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", background: C.paper, borderTopLeftRadius: 22, borderTopRightRadius: 22,
          borderTop: `1px solid ${C.line}`, padding: "20px 22px calc(22px + env(safe-area-inset-bottom))",
          animation: "mc-sheet .26s ease", maxHeight: "80%", overflowY: "auto",
        }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 999, background: C.line, margin: "0 auto 16px" }} />
        {children}
      </div>
    </Backdrop>
  );
}

/** Solid / outline pill button used across screens. */
export function PillButton({
  children, onClick, variant = "solid", danger, full, style,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "solid" | "outline";
  danger?: boolean;
  full?: boolean;
  style?: CSSProperties;
}) {
  const color = danger ? C.signal : C.ink;
  const solid = variant === "solid";
  return (
    <button
      onClick={onClick}
      className="mc-lift"
      style={{
        fontFamily: "var(--mono)", fontSize: 12, letterSpacing: ".04em", borderRadius: 999, padding: "12px 18px",
        cursor: "pointer", border: `1px solid ${color}`,
        background: solid ? color : "transparent", color: solid ? C.paper : color,
        flex: full ? 1 : undefined, textAlign: "center", ...style,
      }}
    >
      {children}
    </button>
  );
}

export const eyebrow: CSSProperties = {
  fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: C.mute,
};
export const h1: CSSProperties = { fontSize: 27, fontWeight: 600, letterSpacing: "-.02em", margin: 0 };
export const h2: CSSProperties = { fontSize: 24, fontWeight: 600, letterSpacing: "-.01em", margin: 0 };
export const hintText: CSSProperties = { fontFamily: "var(--mono)", fontSize: 11, color: C.mute, lineHeight: 1.6 };
