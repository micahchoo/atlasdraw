// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 Task 11 — CollabWrapper.
//
// Conditional collab UI gateway. Returns null when collaboration is disabled
// (Q1 contract: single-player deployment must function identically to
// Phase 4 — zero WebSocket connections, zero collab UI). When active,
// renders CursorOverlay (SVG cursor dots + labels) and PresenceList
// (compact sidebar collaborator list).
//
// Flow position: Step 2 of 3 in client-collab (collab-state → cursor-presence
// → presence-list). Upstream contract: useCollab() hook.
// Downstream contract: consumed by MapEditor or root-level collab layout.
//
// Plan: docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md § Task 11
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React from "react";
import { useCollab } from "../hooks/useCollab";
import { CursorOverlay } from "./CursorOverlay";
import { PresenceList } from "./PresenceList";

/**
 * Renders collab UI (cursor overlays + presence list) when `active` is true;
 * returns null otherwise. The `active` flag is driven by
 * `getAppConfig().realtime.enabled` (reads VITE_REALTIME_ENABLED).
 *
 * When inactive, this component contributes zero DOM, zero WebSocket
 * connections, and zero collab-related rendering overhead — matching the
 * Phase 4 single-player contract.
 */
export function CollabWrapper() {
  const { active } = useCollab();

  if (!active) return null;

  return (
    <>
      <CursorOverlay />
      <PresenceList />
    </>
  );
}
