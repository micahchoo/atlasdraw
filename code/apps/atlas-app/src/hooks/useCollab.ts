// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 Task 7 — useCollab React hook.
//
// Wraps CollabState in a React context so that any descendant component can
// read the connection state, peers map, and local cursor — or initiate a
// connect/disconnect lifecycle.
//
// When a CollabContext.Provider is mounted (e.g. by MapEditor after Task 11
// wiring), the hook returns the managed CollabState from that provider.
// Without a provider, the hook falls back to a default-inactive CollabState
// (no connections, no peers) so consumers never need null-checking.
//
// Flow position: Step 2 of 3 in client-collab (collab-state → useCollab → UI).
// Upstream contract: CollabState from state/collab.ts.
// Downstream contract: consumed by CollabWrapper, CursorOverlay, PresenceList
//   (Task 11) and useYjsLayer (Task 9).

import { createContext, useContext, useRef } from "react";

import { CollabState } from "../state/collab";

import type * as Y from "yjs";

import type { PeerMeta, CursorState } from "../state/collab";
import type { CommentsLayer } from "../state/comments";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface CollabContextValue {
  active: boolean;
  peers: Map<string, PeerMeta>;
  localCursor: CursorState;
  yjsDoc: Y.Doc | null;
  /** Phase 6 A3 — anchored-comments Y.Doc layer (null until connect()). */
  commentsLayer: CommentsLayer | null;
  connect: (
    roomId: string,
    key?: CryptoKey,
    workspaceId?: string | null,
  ) => void;
  disconnect: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * React context carrying the current CollabState. Null when realtime is
 * disabled or no provider is mounted (both paths produce the same fallback:
 * an inactive CollabState that never connects).
 */
export const CollabContext = createContext<CollabContextValue | null>(null);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the collaborative-editing state: connection lifecycle, peer presence,
 * local cursor.
 *
 * Returns an inactive CollabState by default (when no provider is mounted or
 * realtime is disabled). Callers never null-check; the returned value always
 * has the same shape.
 */
export function useCollab(): CollabContextValue {
  const ctx = useContext(CollabContext);
  if (ctx) {
    return ctx;
  }

  // No provider — create a fallback CollabState (inactive when realtime is
  // disabled; otherwise available but unconnected until connect() is called).
  // The ref ensures a stable instance across renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const collabRef = useRef<CollabState | null>(null);
  if (!collabRef.current) {
    collabRef.current = new CollabState();
  }
  const collab = collabRef.current;

  return {
    active: collab.active,
    peers: collab.peers,
    localCursor: collab.localCursor,
    yjsDoc: collab.yjsDoc,
    commentsLayer: collab.commentsLayer,
    connect: collab.connect.bind(collab),
    disconnect: collab.disconnect.bind(collab),
  };
}
