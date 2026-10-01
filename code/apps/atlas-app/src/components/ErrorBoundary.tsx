/**
 * ErrorBoundary — catches unhandled React errors and renders a crash screen.
 *
 * Wraps the app at the top level. Shows the error message + stack trace
 * with a reload button. Prevents the white-screen-of-death.
 *
 * Design: calm drafting-room fallback — brief message, technical details
 * in mono, blueprint accent on the recovery action.
 *
 * As the editor unmounts, usePersistenceWiring saves the open map's
 * unsaved changes (state/lastSave.ts). The message says what that save did,
 * and Reload waits for it, so the promise on screen is true.
 */

import React, { Component } from "react";

import { dismissBootShell } from "../bootShell";
import { lastSave } from "../state/lastSave";
import styles from "../styles/ErrorBoundary.module.css";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** What the save made as the editor went away did. */
  saved: "pending" | "saved" | "failed";
}

/** Reload does not wait longer than this for the last save. */
const SAVE_WAIT_MS = 5000;

const waitForSave = (): Promise<boolean> =>
  Promise.race([
    lastSave(),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), SAVE_WAIT_MS),
    ),
  ]);

// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, saved: "pending" };
  }

  static getDerivedStateFromError(
    error: Error,
  ): Pick<ErrorBoundaryState, "error"> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
    // A route chunk that fails to load never mounts, so the normal dismissal
    // in App.tsx never fires and the boot shell would sit on top of this
    // crash screen — a frozen silhouette, the white-screen-of-death repainted
    // in vellum. Clear it here so the error is actually visible.
    dismissBootShell();
    // The editor's unmount save started in this same commit, before this.
    void waitForSave().then((ok) =>
      this.setState({ saved: ok ? "saved" : "failed" }),
    );
  }

  handleReload = () => {
    void waitForSave().then(() => window.location.reload());
  };

  render() {
    if (this.state.error) {
      const { error } = this.state;
      return (
        <div className={styles.root} data-testid="error-boundary">
          <div className={styles.card}>
            <h1 className={styles.heading}>Something went wrong</h1>
            <p className={styles.message} data-testid="error-boundary-save">
              {this.state.saved === "pending"
                ? "Atlasdraw stopped because of an unexpected error. Saving your changes in this browser…"
                : this.state.saved === "saved"
                ? "Atlasdraw stopped because of an unexpected error. Your changes are saved in this browser; Reload opens the map again."
                : "Atlasdraw stopped because of an unexpected error. Your last changes could not be saved; Reload opens the map as it was last saved."}
            </p>
            {error.message && (
              <pre className={styles.details}>
                {error.message}
                {"\n\n"}
                {error.stack?.split("\n").slice(1, 8).join("\n") ?? ""}
              </pre>
            )}
            <button
              type="button"
              className={styles.button}
              onClick={this.handleReload}
              data-testid="error-boundary-reload"
            >
              Reload Atlasdraw
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
