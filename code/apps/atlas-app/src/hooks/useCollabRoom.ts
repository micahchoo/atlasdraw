// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 collab integration — Step 5.
//
// useCollabRoom — bridge between the URL fragment (`#room:<id>,<key>`) and
// CollabState.connect(). Reads window.location.hash exactly once on mount
// and, if it carries a room fragment AND realtime is enabled, decodes the
// key and opens the live session.
//
// Q-P5-2: the presence of a room key on the URL is the write capability for
// this client. The hook only fires for the editor (`/`) path — App.tsx routes
// `/m + #room:` defensively to ShareView (never grants write via path
// mismatch). See `App.tsx` pickView() for the routing gate.
//
// Q-P5-1: the actual snapshot pull happens inside CollabState.connect()
// (REQUEST_SNAPSHOT → SCENE_SNAPSHOT joining-window). This hook only opens
// the socket; the joiner-pull election protocol lives in collab.ts.

import { useEffect, useState } from "react";
import { parseRoomFragment } from "@atlasdraw/protocol";

import type { CollabState } from "../state/collab";

export interface UseCollabRoomResult {
  /** True from mount until the room fragment is parsed (or fails). */
  isConnecting: boolean;
  /** Non-null when the fragment is present but malformed. */
  error: string | null;
}

/**
 * Read `window.location.hash`. If it starts with `#room:` and the supplied
 * CollabState has realtime enabled (`collabState.active === true`), parse the
 * fragment and call `connect(roomId, key)`. Otherwise no-op.
 *
 * Resting state ({ isConnecting: false, error: null }) is returned when:
 *   - SSR (no window),
 *   - hash is not a room fragment,
 *   - realtime is disabled.
 *
 * Error state is set when the fragment IS a `#room:` shape but parsing fails
 * (malformed base64 key, wrong-length key, etc.). The dialog/banner shows
 * this string to the user.
 *
 * Called once per mount — empty dependency array, by design.
 */
export function useCollabRoom(collabState: CollabState): UseCollabRoomResult {
  const [isConnecting, setIsConnecting] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    const hash = window.location.hash;
    return hash.startsWith("#room:") && collabState.active;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // SSR guard — no hash, no work.
    if (typeof window === "undefined") {
      return;
    }

    const hash = window.location.hash;
    if (!hash.startsWith("#room:")) {
      setIsConnecting(false);
      return;
    }
    if (!collabState.active) {
      // Realtime disabled — leave the hash untouched (a future toggle could
      // re-enable) but do nothing here. The default single-player UX (Q1).
      setIsConnecting(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const roomKey = await parseRoomFragment(hash);
        if (cancelled) {
          return;
        }
        if (roomKey === null) {
          setError("Invalid room link");
          setIsConnecting(false);
          return;
        }
        // Q-P5-2: URL key grants write capability. CollabState.connect() opens
        // both the Socket.IO and the y-websocket channels and emits
        // REQUEST_SNAPSHOT (Q-P5-1) for scene catch-up.
        collabState.connect(roomKey.roomId, roomKey.key);
        setIsConnecting(false);
      } catch (e) {
        if (cancelled) {
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to join room");
        setIsConnecting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isConnecting, error };
}
