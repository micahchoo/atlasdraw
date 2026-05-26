// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A14b — AriaAnnouncer.
//
// One hidden aria-live region rendered near the root. Surfaces use a Zustand
// store via `useAnnounce()` to publish polite text into it: layer-visibility
// toggles, incoming comments, selection changes, etc.
//
// References (WAI-ARIA Authoring Practices — live regions):
//   https://www.w3.org/WAI/ARIA/apg/practices/structural-roles/#live_regions
//   https://www.w3.org/TR/wai-aria-1.2/#aria-live
//
// Design choice — we render a manual `<div role="status" aria-live="polite"
// aria-atomic="true">` rather than depend on `@react-aria/announce`. The
// react-aria announcer ships a non-trivial DOM tree and a portal that is
// heavier than what we need; the WCAG-compliant minimum is a single
// visually-hidden live region with text content updates. Documenting the
// choice here per A14b acceptance criteria.
//
// The region is visually-hidden via the standard sr-only CSS pattern —
// `display: none` would hide it from assistive technology too.
//
// Debounce / reset: when two announcements arrive within ~50ms, we clear the
// region briefly before applying the second so screen readers re-trigger the
// announcement (otherwise some readers skip identical or rapidly-changed
// text). The "clear → set" cycle uses two state writes.

import React, { useEffect, useRef } from "react";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface AnnouncerState {
  message: string;
  /** Increment on each announce() so identical text re-triggers. */
  seq: number;
  announce: (message: string) => void;
}

export const useAnnouncerStore = create<AnnouncerState>((set) => ({
  message: "",
  seq: 0,
  announce: (message: string) => set((s) => ({ message, seq: s.seq + 1 })),
}));

/**
 * Public hook — components call `const announce = useAnnounce()` and then
 * `announce("Layer X shown")`. Returns a stable function so callers can pass
 * it into effects without re-runs.
 */
export const useAnnounce = (): ((message: string) => void) => {
  return useAnnouncerStore((s) => s.announce);
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Mount once near the React root. Renders an aria-live="polite" region that
 * mirrors the announcer store. The "clear → set" two-tick reset ensures
 * identical successive messages still announce.
 */
export const AriaAnnouncer: React.FC = () => {
  const message = useAnnouncerStore((s) => s.message);
  const seq = useAnnouncerStore((s) => s.seq);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    // Clear, then on next microtask set the new message — forces SRs to
    // re-announce even when the text is identical.
    el.textContent = "";
    const id = window.setTimeout(() => {
      if (ref.current) {
        ref.current.textContent = message;
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [message, seq]);

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="aria-announcer"
      // sr-only — visually hidden but exposed to assistive tech.
      // `display: none` would suppress AT entirely; do not change this.
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    />
  );
};
