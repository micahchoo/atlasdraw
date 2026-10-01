// SPDX-License-Identifier: AGPL-3.0-only
//
// PresenceList — who else is in the room. One coloured dot and name per
// peer; it collapses to dots alone at four or more. Under the header, a
// status line says when the room is connecting, offline or refused. A peer whose camera is
// known can be clicked to look where they look. The first row is this
// person's own name, which they can change (identity.ts#setDisplayName).
//
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React, { useEffect, useRef, useState } from "react";

import type { Camera } from "@atlasdraw/data";

import styles from "../styles/PresenceList.module.css";

import { MAX_NAME_LENGTH, type Identity } from "../state/identity";

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
  /** This person; with `onRename`, a field to change the name others see. */
  self?: Identity | null;
  onRename?: (name: string) => void;
  /** How the room's connection stands ("Connecting…"); null when joined. */
  connection?: string | null;
}

/**
 * This person's name, editable. Enter or leaving the field sends a changed
 * name; Escape puts the old one back.
 */
function NameField({
  self,
  onRename,
}: {
  self: Identity;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(self.name);
  const cancelled = useRef(false);
  useEffect(() => setDraft(self.name), [self.name]);

  return (
    <label className={styles.selfRow}>
      <span
        className={styles.avatarDot}
        style={{ backgroundColor: self.color }}
      />
      <span className={styles.srOnly}>Your name</span>
      <input
        className={styles.selfName}
        type="text"
        value={draft}
        maxLength={MAX_NAME_LENGTH}
        title="Your name, as the others in this map see it"
        data-testid="presence-self-name"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // The editor's shortcuts must not see letters typed here.
          event.stopPropagation();
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            cancelled.current = true;
            setDraft(self.name);
            event.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          const name = draft.trim();
          if (name && name !== self.name) {
            onRename(name);
          } else {
            setDraft(self.name);
          }
        }}
      />
    </label>
  );
}

/**
 * The peers in the room, and this person's name field. Nothing when there
 * is neither.
 */
export function PresenceList({
  peers,
  onGoTo,
  self,
  onRename,
  connection = null,
}: PresenceListProps) {
  const count = peers.length;
  const editable = self && onRename ? { self, onRename } : null;

  if (count === 0 && !editable && !connection) {
    return null;
  }

  const compact = count >= 4;
  const headerText =
    count === 0
      ? "Only you"
      : count === 1
      ? "1 collaborator"
      : `${count} collaborators`;

  return (
    <div className={styles.root} data-testid="presence-list">
      <h3 className={styles.header} data-testid="presence-list-header">
        {headerText}
      </h3>
      {/* Always in the list, so a screen reader hears "Offline" when the
          text arrives: a live region added with its text is often not read. */}
      <p
        className={styles.connection}
        role="status"
        data-testid="presence-connection"
      >
        {connection}
      </p>
      {editable && <NameField {...editable} />}
      {compact ? (
        <div className={styles.dotRow} data-testid="presence-list-compact">
          {peers.map((peer) => (
            <span
              key={peer.clientId}
              className={styles.avatarDot}
              style={{ backgroundColor: peer.user.color }}
              title={peer.user.name}
              data-testid={`presence-dot-${peer.clientId}`}
            />
          ))}
        </div>
      ) : (
        <div className={styles.peerList}>
          {peers.map((peer) => {
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
      )}
    </div>
  );
}
