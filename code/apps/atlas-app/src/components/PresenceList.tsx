// SPDX-License-Identifier: AGPL-3.0-only
//
// PresenceList — who else is in the room. One coloured dot and name per
// peer; it collapses to dots alone at four or more. A peer whose camera is
// known can be clicked to look where they look.
//
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React from "react";

import type { Camera } from "@atlasdraw/data";

import styles from "../styles/PresenceList.module.css";

import type { Peer } from "../state/room";

/**
 * Truncate a string to `max` characters, appending "..." when exceeded.
 */
function truncate(name: string, max = 12): string {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max)}…`;
}

export interface PresenceListProps {
  peers: readonly Peer[];
  /** Move this viewer's map to a peer's camera. */
  onGoTo?: (camera: Camera) => void;
}

/** The peers in the room; nothing when there are none. */
export function PresenceList({ peers, onGoTo }: PresenceListProps) {
  const entries = peers;
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
            key={peer.clientId}
            className={styles.avatarDot}
            style={{ backgroundColor: peer.user.color }}
            title={peer.user.name}
            data-testid={`presence-dot-${peer.clientId}`}
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
        {entries.map((peer) => {
          const camera = peer.camera;
          const content = (
            <>
              <span
                className={styles.avatarDot}
                style={{ backgroundColor: peer.user.color }}
              />
              <span className={styles.username} title={peer.user.name}>
                {truncate(peer.user.name)}
              </span>
            </>
          );
          return camera && onGoTo ? (
            <button
              key={peer.clientId}
              type="button"
              className={`${styles.peerRow} ${styles.peerButton}`}
              data-testid={`presence-peer-${peer.clientId}`}
              aria-label={`Go to where ${peer.user.name} is looking`}
              onClick={() => onGoTo(camera)}
            >
              {content}
            </button>
          ) : (
            <div
              key={peer.clientId}
              className={styles.peerRow}
              data-testid={`presence-peer-${peer.clientId}`}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
