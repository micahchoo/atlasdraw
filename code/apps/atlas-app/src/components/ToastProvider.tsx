/**
 * ToastProvider + useToast — transient notification system.
 *
 * Toasts stack bottom-right, above the status bar, and auto-dismiss after
 * 4 seconds. Types: success, error, info, warning. Each toast carries a
 * colored dot + message + dismiss button.
 *
 * For a screen reader: two live regions are always in the page, so a toast
 * is read when it arrives (a region added together with its text is often
 * not read). An error goes to the `alert` region, which interrupts; the rest
 * go to the polite `status` region. Both are marked `data-live-region`, so
 * an open Modal does not make them inert.
 *
 * A toast stays while the pointer or the focus is on the stack (WCAG
 * 2.2.1), and its time goes on from where it stopped.
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

import { Button } from "./Button";

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
  /** A button beside the message, for example Cancel on a running import. */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Stays until dismissed in code; for work that is still running. */
  sticky?: boolean;
  action?: ToastAction;
}

/** A sticky toast for work in progress. */
export interface ProgressToast {
  update: (message: string) => void;
  close: () => void;
}

interface ToastContextValue {
  /** Queue a toast. Returns the id for early dismissal. */
  add: (kind: ToastKind, message: string, options?: ToastOptions) => number;
  /** Change the message of a toast that is shown. */
  update: (id: number, message: string) => void;
  dismiss: (id: number) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

/** How long a toast stays, unless the pointer or the focus holds it. */
const TOAST_MS = 4000;

/** A toast's auto-dismiss: the time it has left, and its timer if running. */
interface Countdown {
  left: number;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  done: () => void;
}

function start(c: Countdown): void {
  if (c.timer === null) {
    c.startedAt = Date.now();
    c.timer = setTimeout(c.done, c.left);
  }
}

function stop(c: Countdown): void {
  if (c.timer !== null) {
    clearTimeout(c.timer);
    c.timer = null;
    c.left = Math.max(0, c.left - (Date.now() - c.startedAt));
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  /** Each running toast's timer, and the time it has left. */
  const timersRef = useRef<Map<number, Countdown>>(new Map());
  /** True while the pointer or the focus is on the stack. */
  const pausedRef = useRef({ hover: false, focus: false });
  const exitTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Work that ends after an unmount (an import, for example) can still close
  // its toast. It must not start a timer that outlives the provider.
  const mountedRef = useRef(true);

  const dismiss = useCallback((id: number) => {
    // Clear any pending auto-dismiss timer.
    const countdown = timersRef.current.get(id);
    if (countdown) {
      stop(countdown);
      timersRef.current.delete(id);
    }

    if (!mountedRef.current) {
      return;
    }
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );

    // Remove after exit animation. Kept with the other timers, so an
    // unmount cancels it.
    const exit = setTimeout(() => {
      exitTimersRef.current.delete(exit);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 160);
    exitTimersRef.current.add(exit);
  }, []);

  const add = useCallback(
    (kind: ToastKind, message: string, options: ToastOptions = {}): number => {
      const id = nextId++;
      if (!mountedRef.current) {
        return id;
      }

      setToasts((prev) => [
        ...prev,
        { id, kind, message, exiting: false, action: options.action },
      ]);

      // Auto-dismiss after 4 seconds, unless the work is still running.
      if (!options.sticky) {
        const countdown: Countdown = {
          left: TOAST_MS,
          startedAt: 0,
          timer: null,
          done: () => dismiss(id),
        };
        timersRef.current.set(id, countdown);
        const { hover, focus } = pausedRef.current;
        if (!hover && !focus) {
          start(countdown);
        }
      }

      return id;
    },
    [dismiss],
  );

  const update = useCallback((id: number, message: string) => {
    if (!mountedRef.current) {
      return;
    }
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, message } : t)));
  }, []);

  // Cleanup timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    const exitTimers = exitTimersRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timers.forEach(stop);
      exitTimers.forEach((t) => clearTimeout(t));
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

  const setPaused = useCallback((part: "hover" | "focus", on: boolean) => {
    const paused = pausedRef.current;
    const was = paused.hover || paused.focus;
    paused[part] = on;
    const now = paused.hover || paused.focus;
    if (was !== now) {
      timersRef.current.forEach(now ? stop : start);
    }
  }, []);

  const shown = (kind: "alert" | "status") =>
    toasts
      .filter((t) => (t.kind === "error") === (kind === "alert"))
      .map((t) => (
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
          {t.action && (
            <Button
              size="sm"
              data-testid="toast-action"
              onClick={t.action.onClick}
            >
              {t.action.label}
            </Button>
          )}
          <Button
            variant="ghost-icon"
            size="sm"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            ×
          </Button>
        </div>
      ));

  // Stable context identity: consumers hang effects off useToast()'s
  // callbacks (e.g. MapEditor's persistence wiring) — a fresh value object
  // per render would re-fire all of them on every toast.
  const contextValue = React.useMemo(
    () => ({ add, update, dismiss }),
    [add, update, dismiss],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        className={styles.container}
        data-testid="toast-container"
        data-live-region
        onMouseEnter={() => setPaused("hover", true)}
        onMouseLeave={() => setPaused("hover", false)}
        onFocus={() => setPaused("focus", true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setPaused("focus", false);
          }
        }}
      >
        <div
          className={styles.region}
          role="status"
          aria-live="polite"
          data-testid="toast-status"
        >
          {shown("status")}
        </div>
        <div
          className={styles.region}
          role="alert"
          aria-live="assertive"
          data-testid="toast-alert"
        >
          {shown("alert")}
        </div>
      </div>
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
    /** A sticky info toast with a Cancel button, until `close`. */
    progress: useCallback(
      (msg: string, onCancel: () => void): ProgressToast => {
        const id = ctx.add("info", msg, {
          sticky: true,
          action: { label: "Cancel", onClick: onCancel },
        });
        return {
          update: (next) => ctx.update(id, next),
          close: () => ctx.dismiss(id),
        };
      },
      [ctx],
    ),
    dismiss: ctx.dismiss,
  };
}
