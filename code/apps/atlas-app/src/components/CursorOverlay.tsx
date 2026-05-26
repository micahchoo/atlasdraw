// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 Task 11 — CursorOverlay.
//
// Absolutely positioned SVG layer over the canvas showing remote peer cursors
// as colored dots with username labels. Each cursor bounces briefly when its
// position changes, giving spatial awareness without intrusive UI.
//
// Flow position: Step 2 of 3 in client-collab (collab-state → cursor-presence
// → presence-list). Upstream contract: useCollab().peers map.
// Downstream contract: consumed by CollabWrapper (Task 11).
//
// Plan: docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md § Task 11
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React, { useEffect, useRef } from "react";

import { useCollab } from "../hooks/useCollab";
import styles from "../styles/CursorOverlay.module.css";

/**
 * SVG cursor overlay for remote collaborator awareness.
 *
 * Renders one colored dot + username label per peer in the `peers` map.
 * A bounce animation (opacity pulse) fires when a peer's cursor position
 * changes, helping the local user notice movement in peripheral vision.
 * The entire SVG has `pointer-events: none` so it never intercepts
 * mouse/touch events destined for Excalidraw or the map layer below.
 */
export function CursorOverlay() {
  const { peers } = useCollab();

  // Track last-seen cursor positions per peer to detect movement.
  const lastPositions = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  // Active bounce animation timers so we can clean up on unmount.
  const bounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Set of peer IDs currently in the "bouncing" visual state.
  const bouncingRef = useRef<Set<string>>(new Set());
  // Container ref for the SVG — we toggle classes via data attributes to
  // avoid a useState-and-render cycle for visual-only animation state.
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Detect cursor position changes and trigger bounce animation.
  // The bounce is purely visual (CSS class toggle via data attribute on
  // individual <g> elements). We use refs + direct DOM access for the
  // animation class so that high-frequency CURSOR events don't cascade
  // through React reconciliation on every frame.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    for (const [id, peer] of peers) {
      if (!peer.cursor) {
        continue;
      }
      const prev = lastPositions.current.get(id);

      if (!prev || prev.x !== peer.cursor.x || prev.y !== peer.cursor.y) {
        // Record new position.
        lastPositions.current.set(id, {
          x: peer.cursor.x,
          y: peer.cursor.y,
        });

        // Mark the group element as bouncing.
        const group = svg.querySelector<SVGGElement>(`[data-peer-id="${id}"]`);
        if (group) {
          group.classList.add(styles.bouncing);
          bouncingRef.current.add(id);
        }

        // Clear any existing bounce timer for this peer.
        const existing = bounceTimers.current.get(id);
        if (existing) {
          clearTimeout(existing);
        }

        // Remove bounce class after animation completes.
        const timer = setTimeout(() => {
          const g = svg.querySelector<SVGGElement>(`[data-peer-id="${id}"]`);
          if (g) {
            g.classList.remove(styles.bouncing);
          }
          bouncingRef.current.delete(id);
          bounceTimers.current.delete(id);
        }, 500);
        bounceTimers.current.set(id, timer);
      }
    }
  }, [peers]);

  // Cleanup all bounce timers on unmount.
  useEffect(() => {
    const timers = bounceTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const entries = Array.from(peers.entries());

  return (
    <svg ref={svgRef} className={styles.overlay} data-testid="cursor-overlay">
      {entries.map(([id, peer]) => {
        if (!peer.cursor) {
          return null;
        }
        return (
          <g key={id} data-peer-id={id}>
            <circle
              cx={peer.cursor.x}
              cy={peer.cursor.y}
              r={4}
              fill={peer.color}
            />
            <text
              x={peer.cursor.x}
              y={peer.cursor.y - 10}
              fill={peer.color}
              fontSize="11"
              fontFamily="system-ui, sans-serif"
              textAnchor="middle"
            >
              {peer.username}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
