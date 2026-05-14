// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — y-websocket server integration.
//
// Registers an upgrade handler on the shared http.Server for /yjs/:roomId.
// Uses y-websocket's setupWSConnection to manage the Yjs CRDT document
// lifecycle per room (in-process Map, no persistence at relay level).
//
// Under ADR-0010 Option C the relay sees plaintext Yjs ops — by design.
//
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md § Task 6.

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
 * Rooms at `/yjs/:roomId` are managed in-process by y-websocket's
 * `WSSharedDoc` map (`setupWSConnection`).  When the last client
 * disconnects, the room doc is held for `ROOM_TTL_MS` before eviction
 * (no persistence at the relay level — see ADR-0010 Option C).
 *
 * The y-websocket connection runs on the **same** `http.Server` as
 * Socket.IO but on a **separate** TCP stream (`/yjs/:roomId` path).
 * This is the Q-9 split — eliminates head-of-line blocking between
 * Yjs catch-up and cursor events.
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
