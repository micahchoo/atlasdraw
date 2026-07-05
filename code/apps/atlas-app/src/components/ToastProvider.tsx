/**
 * ToastProvider + useToast — transient notification system.
 *
 * Toasts stack bottom-right, above the status bar, and auto-dismiss after
 * 4 seconds. Types: success, error, info, warning. Each toast carries a
 * colored dot + message + dismiss button.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success("432 features imported");
 *   toast.error("Failed to save");
 *
 * Design: drafting-room feedback — brief, precise, unobtrusive. The
 * cartographer glances at it and keeps working.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";

import styles from "../styles/Toast.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastKind = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** True during exit animation; removed after animation completes. */
  exiting: boolean;
}

interface ToastContextValue {
  /** Queue a toast. Returns the id for early dismissal. */
  add: (kind: ToastKind, message: string) => number;
  dismiss: (id: number) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const dismiss = useCallback((id: number) => {
    // Clear any pending auto-dismiss timer.
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );

    // Remove after exit animation.
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 160);
  }, []);

  const add = useCallback(
    (kind: ToastKind, message: string): number => {
      const id = nextId++;

      setToasts((prev) => [...prev, { id, kind, message, exiting: false }]);

      // Auto-dismiss after 4 seconds.
      const timer = setTimeout(() => dismiss(id), 4000);
      timersRef.current.set(id, timer);

      return id;
    },
    [dismiss],
  );

  // Cleanup timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Cap at 5 toasts — dismiss oldest.
  useEffect(() => {
    if (toasts.length > 5) {
      const oldest = toasts[0];
      if (oldest && !oldest.exiting) {
        dismiss(oldest.id);
      }
    }
  }, [toasts, dismiss]);

  // Stable context identity: consumers hang effects off useToast()'s
  // callbacks (e.g. MapEditor's persistence wiring) — a fresh value object
  // per render would re-fire all of them on every toast.
  const contextValue = React.useMemo(() => ({ add, dismiss }), [add, dismiss]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.length > 0 && (
        <div
          className={styles.container}
          role="status"
          aria-live="polite"
          data-testid="toast-container"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={[styles.toast, t.exiting ? styles.toastOut : ""]
                .filter(Boolean)
                .join(" ")}
              data-testid={`toast-${t.kind}`}
            >
              <span
                className={[
                  styles.dot,
                  t.kind === "success" ? styles.dotSuccess : "",
                  t.kind === "error" ? styles.dotError : "",
                  t.kind === "info" ? styles.dotInfo : "",
                  t.kind === "warning" ? styles.dotWarning : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
              <span className={styles.message}>{t.message}</span>
              <button
                type="button"
                className={styles.dismiss}
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return {
    success: useCallback((msg: string) => ctx.add("success", msg), [ctx]),
    error: useCallback((msg: string) => ctx.add("error", msg), [ctx]),
    info: useCallback((msg: string) => ctx.add("info", msg), [ctx]),
    warning: useCallback((msg: string) => ctx.add("warning", msg), [ctx]),
    dismiss: ctx.dismiss,
  };
}
