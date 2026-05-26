/**
 * OnboardingTips — first-run tooltip walkthrough for new users.
 *
 * Shows a brief tour of key UI elements. Dismissed permanently via
 * localStorage flag. Steps point at real UI landmarks with position hints.
 *
 * Design: warm, brief, dismissable — the drafting-room greets you, then
 * gets out of your way.
 */

import React, { useState, useCallback } from "react";

import styles from "../styles/OnboardingTips.module.css";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = "atlasdraw-onboarding-dismissed";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private mode — no-op */
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

interface Step {
  title: string;
  body: string;
  /** CSS position for the tip, relative to viewport. */
  position: { top?: number; bottom?: number; left?: number; right?: number };
}

const STEPS: Step[] = [
  {
    title: "Welcome to Atlasdraw",
    body: "A collaborative map studio — draw, annotate, and style on top of a real GIS basemap. Your drawings stay geographically anchored as you pan and zoom.",
    position: { top: 80, left: 24 },
  },
  {
    title: "Everything lives in the menu",
    body: "Tools, layers, export, share, basemap settings — all accessible from the top-left hamburger menu. Click it to explore.",
    position: { top: 12, left: 12 },
  },
  {
    title: "Draw with atlas tools",
    body: 'Select "Pin to map" or other tools from the menu to start annotating. Your marks reproject on every camera move — they stay where you drew them.',
    position: { top: 80, left: 24 },
  },
  {
    title: "Quick actions",
    body: "Press Cmd+K (Ctrl+K) to search across all tools, actions, and panels. Press ? to see all keyboard shortcuts.",
    position: { top: 200, left: 24 },
  },
  {
    title: "You're ready",
    body: "Import GeoJSON by dragging files onto the map. Your work saves automatically. Share a link to collaborate in real time.",
    position: { top: 80, left: 24 },
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OnboardingTipsProps {
  onDismiss: () => void;
}

export function OnboardingTips({ onDismiss }: OnboardingTipsProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      setDismissed();
      onDismiss();
    }
  }, [step, onDismiss]);

  const handleSkip = useCallback(() => {
    setDismissed();
    onDismiss();
  }, [onDismiss]);

  return (
    <div className={styles.scrim} data-testid="onboarding-scrim">
      <div
        className={styles.tip}
        style={{
          top: current.position.top,
          left: current.position.left,
          bottom: current.position.bottom,
          right: current.position.right,
        }}
        data-testid="onboarding-tip"
      >
        <h2 className={styles.title}>{current.title}</h2>
        <p className={styles.body}>{current.body}</p>
        <div className={styles.actions}>
          <span className={styles.steps}>
            {step + 1} / {STEPS.length}
          </span>
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.btn}
              onClick={handleSkip}
              data-testid="onboarding-skip"
            >
              Skip
            </button>
            <button
              type="button"
              className={[styles.btn, styles.btnPrimary].join(" ")}
              onClick={handleNext}
              data-testid="onboarding-next"
            >
              {step < STEPS.length - 1 ? "Next" : "Got it"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook — returns whether to show onboarding, and the dismiss handler
// ---------------------------------------------------------------------------

export function useOnboarding(): {
  show: boolean;
  dismiss: () => void;
} {
  const [show, setShow] = useState(!isDismissed());

  const dismiss = useCallback(() => setShow(false), []);

  return { show, dismiss };
}
