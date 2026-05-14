// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — relay server entry point.
//
// Creates an http.Server, mounts:
//   - GET /health (plain HTTP)
//   - Socket.IO on /socket.io (stub — real handlers in Task 5)
//   - y-websocket upgrade handler on /yjs/:roomId (stub — real wiring in Task 6)
//
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md § Task 3.

import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { registerHealth } from "./health";
import type { CollabEvent, RealtimeConfig } from "@atlasdraw/protocol";

const PORT = parseInt(process.env["PORT"] ?? "4001", 10);

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
const server = http.createServer();

// Health endpoint — must be registered before Socket.IO so it runs first.
registerHealth(server);
console.log("[realtime] health endpoint mounted on GET /health");

// ---------------------------------------------------------------------------
// Socket.IO (stub — Task 5 wires event handlers)
// ---------------------------------------------------------------------------
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
console.log(`[realtime] Socket.IO mounted on /socket.io (stub — ${Object.keys(io?.of ?? {}).length} namespaces)`);

// ---------------------------------------------------------------------------
// y-websocket upgrade handler (stub — Task 6 wires setupWSConnection)
// ---------------------------------------------------------------------------
server.on("upgrade", (request, socket, head) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/yjs/")) {
      const roomId = url.pathname.slice("/yjs/".length);
      console.log(`[realtime] y-websocket upgrade for room: ${roomId} (stub)`);
      // Stub: close the connection. Task 6 replaces this with setupWSConnection.
      socket.destroy();
    }
    // Non-/yjs/ upgrades pass through (e.g. Socket.IO WebSocket transport).
  } catch {
    socket.destroy();
  }
});
console.log("[realtime] y-websocket handler mounted on /yjs/:roomId (stub)");

// ---------------------------------------------------------------------------
// Listen
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`[realtime] relay listening on port ${PORT}`);
});
