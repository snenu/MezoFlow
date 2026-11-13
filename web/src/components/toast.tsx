"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { txUrl } from "@/lib/chain";
import { shortHash } from "@/lib/format";

type Status = "pending" | "success" | "error" | "info";
type Toast = { id: number; title: string; body?: string; hash?: string; status: Status };

type Ctx = {
  push: (t: Omit<Toast, "id">) => number;
  update: (id: number, t: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const reduce = useReducedMotion();

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const schedule = useCallback(
    (id: number, status: Status) => {
      const old = timers.current.get(id);
      if (old) clearTimeout(old);
      if (status === "pending") return;
      timers.current.set(id, setTimeout(() => dismiss(id), status === "error" ? 9000 : 6000));
    },
    [dismiss],
  );

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      schedule(id, t.status);
      return id;
    },
    [schedule],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.status) schedule(id, patch.status);
    },
    [schedule],
  );

  const value = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-live="polite" aria-label="Transaction updates">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout={!reduce}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: 40 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className={`toast toast-${t.status}`}
            >
              <span className="toast-icon" aria-hidden>
                {t.status === "pending" ? <span className="spinner" /> : t.status === "success" ? "✓" : t.status === "error" ? "!" : "i"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="toast-title">{t.title}</p>
                {t.body && <p className="toast-body">{t.body}</p>}
                {t.hash && (
                  <a className="toast-link" href={txUrl(t.hash)} target="_blank" rel="noreferrer">
                    View {shortHash(t.hash)} on Mezo Explorer
                  </a>
                )}
              </div>
              <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                ×
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
