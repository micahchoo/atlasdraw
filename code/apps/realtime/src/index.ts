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

import { logger } from "./logger";
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
logger.info("health endpoint mounted on GET /health");

// Socket.IO event handlers — SCENE_UPDATE, MAP_CAMERA_UPDATE, CURSOR, COMMENT
// with per-socket rate limiting (rate-limit.ts). Per ADR-0010, the relay never
// inspects encrypted payload content.
registerSocketIOHandlers(io);
logger.info("Socket.IO event handlers registered on /socket.io");

// ---------------------------------------------------------------------------
// y-websocket upgrade handler — delegates to yjs-server.ts
// ---------------------------------------------------------------------------
const yjsHandler = registerYjsHandler(server);
logger.info("y-websocket handler mounted on /yjs/:roomId");

// ---------------------------------------------------------------------------
// Optional Redis adapter — opt-in multi-instance scaling
// ---------------------------------------------------------------------------
const redisClients = attachRedisAdapterIfConfigured(io);

// ---------------------------------------------------------------------------
// Listen
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  logger.info({ port: PORT }, "relay listening");
});

// ---------------------------------------------------------------------------
// Graceful shutdown (ISSUES.md Issue 8) — previously absent entirely, so
// `docker compose stop` hard-killed every in-flight collaboration session.
// Mirrors apps/storage/src/index.ts's shutdown shape: stop accepting new
// work, drain what's connected, then exit.
//
// `io.close()` closes every Socket.IO socket, the Engine.IO transport, AND
// the underlying `server` it was constructed with (Socket.IO owns it once
// passed in) — so there is no separate `server.close()` call here; doing
// both would double-close and throw ERR_SERVER_NOT_RUNNING. The y-websocket
// upgrade path is a second, independent WebSocket server on the same TCP
// listener (`noServer: true`), so its already-upgraded connections are
// unaffected by the HTTP server closing and need their own drain step.
// ---------------------------------------------------------------------------
const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "received signal — shutting down");
  await io.close();
  yjsHandler.close();
  if (redisClients) {
    try {
      await Promise.all([
        redisClients.pubClient.quit(),
        redisClients.subClient.quit(),
      ]);
    } catch (err) {
      logger.warn({ err }, "error quitting Redis clients during shutdown");
    }
  }
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
