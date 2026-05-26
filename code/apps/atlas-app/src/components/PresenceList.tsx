// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 Task 11 — PresenceList.
//
// Compact sidebar widget showing connected collaborators. Each peer renders
// as a colored avatar dot with truncated username. Shows "N collaborators"
// header. Collapses to icon-only (dots only) when 4 or more peers are
// connected, conserving screen space.
//
// Flow position: Step 2 of 3 in client-collab (collab-state → cursor-presence
// → presence-list). Upstream contract: useCollab().peers map.
// Downstream contract: consumed by CollabWrapper (Task 11).
//
// Plan: docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md § Task 11
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React from "react";

import { useCollab } from "../hooks/useCollab";
import styles from "../styles/PresenceList.module.css";

/**
 * Truncate a string to `max` characters, appending "..." when exceeded.
 */
function truncate(name: string, max = 12): string {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max)}…`;
}

/**
 * Compact sidebar collaborator list.
 *
 * Renders the current set of connected peers as colored dots with truncated
 * usernames. When 4+ peers are connected the list collapses to icon-only
 * (dots in a row) to conserve screen space. Returns null when there are no
 * peers (collab inactive or empty room).
 */
export function PresenceList() {
  const { peers } = useCollab();
  const entries = Array.from(peers.values());
  const count = entries.length;

  if (count === 0) {
    return null;
  }

  const compact = count >= 4;

  if (compact) {
    return (
      <div className={styles.rootCompact} data-testid="presence-list-compact">
        {entries.map((peer) => (
          <span
            key={peer.id}
            className={styles.avatarDot}
            style={{ backgroundColor: peer.color }}
            title={peer.username}
            data-testid={`presence-dot-${peer.id}`}
          />
        ))}
      </div>
    );
  }

  const headerText = count === 1 ? "1 collaborator" : `${count} collaborators`;

  return (
    <div className={styles.root} data-testid="presence-list">
      <h3 className={styles.header} data-testid="presence-list-header">
        {headerText}
      </h3>
      <div className={styles.peerList}>
        {entries.map((peer) => (
          <div
            key={peer.id}
            className={styles.peerRow}
            data-testid={`presence-peer-${peer.id}`}
          >
            <span
              className={styles.avatarDot}
              style={{ backgroundColor: peer.color }}
            />
            <span className={styles.username} title={peer.username}>
              {truncate(peer.username)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
