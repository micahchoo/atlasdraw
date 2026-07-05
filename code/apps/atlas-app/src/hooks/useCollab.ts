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

import { createContext, useContext, useRef, useSyncExternalStore } from "react";

import { CollabState } from "../state/collab";

import type * as Y from "yjs";

import type { PeerMeta, CursorState, CollabSnapshot } from "../state/collab";
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

const NOOP_SUBSCRIBE = () => () => {};
const NOOP_SNAPSHOT = (): CollabSnapshot => EMPTY_SNAPSHOT;
const EMPTY_SNAPSHOT: CollabSnapshot = {
  peers: new Map(),
  localCursor: { x: 0, y: 0 },
  yjsDoc: null,
  commentsLayer: null,
};

/**
 * Access the collaborative-editing state: connection lifecycle, peer presence,
 * local cursor.
 *
 * Returns an inactive CollabState by default (when no provider is mounted or
 * realtime is disabled). Callers never null-check; the returned value always
 * has the same shape.
 *
 * ISSUES.md Issue 9: peers/yjsDoc/commentsLayer are read through
 * `useSyncExternalStore` against the CollabState's `subscribe`/`getSnapshot` —
 * plain `Map.set()`/field mutations on the underlying channels are otherwise
 * invisible to React, so without this, CursorOverlay/PresenceList would never
 * re-render on a peer joining or a remote cursor moving even with a real
 * connected session.
 */
export function useCollab(): CollabContextValue {
  const ctx = useContext(CollabContext);

  // Fallback CollabState for when no Provider is mounted (isolated hook
  // tests, or a future standalone consumer). Hooks below always run
  // (rules-of-hooks) — only the ref's contents are conditional on `ctx`, so
  // the real app (where a Provider is always mounted per MapEditor) never
  // pays for constructing this second instance.
  const collabRef = useRef<CollabState | null>(null);
  if (!ctx && !collabRef.current) {
    collabRef.current = new CollabState();
  }
  const fallback = collabRef.current;
  const fallbackSnapshot = useSyncExternalStore(
    fallback?.subscribe ?? NOOP_SUBSCRIBE,
    fallback?.getSnapshot ?? NOOP_SNAPSHOT,
  );

  if (ctx) {
    return ctx;
  }

  const collab = fallback!;
  return {
    active: collab.active,
    peers: fallbackSnapshot.peers,
    localCursor: fallbackSnapshot.localCursor,
    yjsDoc: fallbackSnapshot.yjsDoc,
    commentsLayer: fallbackSnapshot.commentsLayer,
    connect: collab.connect.bind(collab),
    disconnect: collab.disconnect.bind(collab),
  };
}
