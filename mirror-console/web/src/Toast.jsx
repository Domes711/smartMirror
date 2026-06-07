import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// App-wide toast notifications, stacked in the top-right corner and colour-coded
// by variant (success = green, error = red, warning = amber, info = blue).
//
// Usage:
//   const toast = useToast();
//   toast.success("Hotovo");
//   toast.error("Něco se nepovedlo");
//   toast.info("…"); toast.warning("…");
//   toast.show(msg, "success", { duration: 6000 });  // duration 0 = sticky

const ToastContext = createContext(null);
const ICONS = { success: "✓", error: "✕", warning: "!", info: "i" };

let idSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (variant, message, opts = {}) => {
      const text = String(message ?? "").trim();
      if (!text) return null;
      const id = ++idSeq;
      const ttl = opts.duration ?? (variant === "error" ? 7000 : 4000);
      setToasts((list) => [...list, { id, variant, message: text }]);
      if (ttl > 0) timers.current.set(id, setTimeout(() => dismiss(id), ttl));
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      show: (m, v = "info", o) => push(v, m, o),
      success: (m, o) => push("success", m, o),
      error: (m, o) => push("error", m, o),
      warning: (m, o) => push("warning", m, o),
      info: (m, o) => push("info", m, o),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host" role="region" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.variant}`}
            role="status"
            onClick={() => dismiss(t.id)}
          >
            <span className="toast-icon">{ICONS[t.variant] || "•"}</span>
            <span className="toast-msg">{t.message}</span>
            <button
              className="toast-close"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
              }}
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
