// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — y-websocket server integration.
//
// Registers an upgrade handler on the shared http.Server. Two Y.Doc families
// share one handler — Yjs's `docs` Map is keyed by docName (= path-suffix),
// so distinct paths produce distinct documents with no further routing logic:
//
//   /yjs/${roomId}                                  Phase 5 data-layer Y.Doc
//   /yjs/comments/${roomId}                         Phase 6 comments Y.Doc
//   /yjs/${workspaceId}/${roomId}                   reserved (Phase 6 A9 follow-up)
//   /yjs/comments/${workspaceId}/${roomId}          Phase 6 workspace-scoped comments
//
// docName = url.pathname.slice("/yjs/".length) — verbatim, no parsing. So
// `comments/foo` and `foo` are different documents on the relay's `docs` map.
// Workspace scoping is achieved at the URL-path layer (Phase 6 A2): clients
// that pass `workspaceId` to `buildCommentsDocPath` get a workspace-namespaced
// docName, so cross-workspace leakage is impossible at the relay layer.
//
// Under ADR-0010 Option C the relay sees plaintext Yjs ops for both Y.Doc
// families — by design. Comment text is NOT encrypted; the trust posture is
// the same as the data-layer Y.Doc (relay-trusted; SaaS deployments rely on
// workspace ACL at the path-routing boundary).
//
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md § Task 6
//     docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A2

import http from "http";
import { WebSocketServer } from "ws";
import { setupWSConnection, docs } from "y-websocket/bin/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ROOM_TTL_MS = parseInt(process.env["ROOM_TTL_MS"] ?? "300000", 10);

// ---------------------------------------------------------------------------
// Eviction state — one timer per room key
// ---------------------------------------------------------------------------
const evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cancelEviction(docName: string): void {
  const timer = evictionTimers.get(docName);
  if (timer !== undefined) {
    clearTimeout(timer);
    evictionTimers.delete(docName);
  }
}

function scheduleEviction(docName: string): void {
  // Guard: don't double-schedule
  if (evictionTimers.has(docName)) return;

  const timer = setTimeout(() => {
    evictionTimers.delete(docName);

    // The docs map is shared with y-websocket's internal getYDoc.
    const ydoc = docs.get(docName);
    if (ydoc !== undefined) {
      ydoc.destroy();
      docs.delete(docName);
      console.warn(
        `[realtime] room ${docName} evicted` +
          ` after TTL=${ROOM_TTL_MS}ms (no persistence wired)`,
      );
    }
  }, ROOM_TTL_MS);

  evictionTimers.set(docName, timer);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers the y-websocket upgrade handler on the shared http.Server.
 *
 * Any path under `/yjs/` is a valid docName — the suffix after `/yjs/` is
 * passed verbatim to `setupWSConnection`'s docName, and Yjs's `docs` map
 * dedupes per-docName. See the file header for the documented path-prefix
 * contract (data-layer at `/yjs/${roomId}`; comments at
 * `/yjs/comments/${roomId}` — Phase 6 A2).
 *
 * When the last client on a docName disconnects, the doc is held for
 * `ROOM_TTL_MS` before eviction (no persistence — see ADR-0010 Option C).
 *
 * The y-websocket connection runs on the **same** `http.Server` as
 * Socket.IO but on a **separate** TCP stream. This is the Q-9 split —
 * eliminates head-of-line blocking between Yjs catch-up and cursor events.
 */
export function registerYjsHandler(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith("/yjs/")) {
        // Non-/yjs/ upgrades pass through (e.g. Socket.IO WebSocket transport).
        return;
      }

      const roomId = url.pathname.slice("/yjs/".length);

      // A new client arrived — cancel any pending eviction for this room.
      cancelEviction(roomId);

      wss.handleUpgrade(request, socket, head, (ws) => {
        setupWSConnection(ws, request, { docName: roomId });

        // When this client disconnects, schedule TTL eviction.
        // setupWSConnection's own close handler runs first (added inside
        // setupWSConnection), so doc.conns is already cleaned up by the
        // time this fires.
        ws.on("close", () => {
          scheduleEviction(roomId);
        });
      });
    } catch {
      socket.destroy();
    }
  });
}

// ---------------------------------------------------------------------------
// TODO Phase 6: replace TTL eviction with
//   setPersistence({ bindState, writeState })
// ---------------------------------------------------------------------------
