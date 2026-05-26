/**
 * ErrorBoundary — catches unhandled React errors and renders a crash screen.
 *
 * Wraps the app at the top level. Shows the error message + stack trace
 * with a reload button. Prevents the white-screen-of-death.
 *
 * Design: calm drafting-room fallback — brief message, technical details
 * in mono, blueprint accent on the recovery action.
 */

import React, { Component } from "react";

import styles from "../styles/ErrorBoundary.module.css";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      const { error } = this.state;
      return (
        <div className={styles.root} data-testid="error-boundary">
          <div className={styles.card}>
            <h1 className={styles.heading}>Something went wrong</h1>
            <p className={styles.message}>
              Atlasdraw encountered an unexpected error. Your work is saved
              locally — reloading will restore it.
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
