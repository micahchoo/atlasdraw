/* eslint-disable no-console */
// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — relay server entry point.
//
// Creates an http.Server, mounts:
//   - GET /health (plain HTTP)
//   - Socket.IO on /socket.io with event handlers (SCENE_UPDATE, MAP_CAMERA_UPDATE,
//     CURSOR, COMMENT — see socket-io-server.ts)
//   - y-websocket upgrade handler on /yjs/:roomId (see yjs-server.ts)
//
// See docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md § Task 3 / Task 5.

import http from "http";

import { Server as SocketIOServer } from "socket.io";

import { registerHealth } from "./health";
import { registerSocketIOHandlers } from "./socket-io-server";
import { registerYjsHandler } from "./yjs-server";
import { attachRedisAdapterIfConfigured } from "./redis-adapter";

const PORT = parseInt(process.env.PORT ?? "4001", 10);

// CORS origin allow-list. Defaults to "*" (any origin) to preserve the
// single-tenant self-host default, but operators SHOULD pin it to their own
// domain(s) once the relay sits behind Caddy at the same origin. Set
// CORS_ORIGIN to a comma-separated list, e.g. "https://atlas.example.com".
const corsOrigin = (() => {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || raw.trim() === "" || raw.trim() === "*") {
    return "*";
  }
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
})();

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
const server = http.createServer();

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
const io = new SocketIOServer(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
  },
});

// Health endpoint — registered before event handlers; passes `io` so the
// response includes the real connection count.
registerHealth(server, io);
console.log("[realtime] health endpoint mounted on GET /health");

// Socket.IO event handlers — SCENE_UPDATE, MAP_CAMERA_UPDATE, CURSOR, COMMENT
// with per-socket rate limiting (rate-limit.ts). Per ADR-0010, the relay never
// inspects encrypted payload content.
registerSocketIOHandlers(io);
console.log("[realtime] Socket.IO event handlers registered on /socket.io");

// ---------------------------------------------------------------------------
// y-websocket upgrade handler — delegates to yjs-server.ts
// ---------------------------------------------------------------------------
registerYjsHandler(server);
console.log("[realtime] y-websocket handler mounted on /yjs/:roomId");

// ---------------------------------------------------------------------------
// Optional Redis adapter — opt-in multi-instance scaling
// ---------------------------------------------------------------------------
attachRedisAdapterIfConfigured(io);

// ---------------------------------------------------------------------------
// Listen
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`[realtime] relay listening on port ${PORT}`);
});
