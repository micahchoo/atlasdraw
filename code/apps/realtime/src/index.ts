// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — the relay: GET /health and the room server on /yjs/.

import { mkdirSync } from "fs";
import http from "http";
import { dirname } from "path";

import { logger } from "./logger.js";
import { registerHealth } from "./health.js";
import { sqliteRoomStore } from "./room-store.js";
import { registerRoomServer, roomLimitsFromEnv } from "./rooms.js";

const PORT = parseInt(process.env.PORT ?? "4001", 10);
const DB_PATH = process.env.ROOMS_DB ?? "./data/rooms.sqlite";

if (DB_PATH !== ":memory:") {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}
const store = sqliteRoomStore(DB_PATH);
const server = http.createServer();
const rooms = registerRoomServer(server, { store, ...roomLimitsFromEnv() });
registerHealth(server, rooms);

server.listen(PORT, () => {
  logger.info({ port: PORT, db: DB_PATH }, "relay listening");
});

// Stop taking connections, save every room, close the store.
const shutdown = (signal: string): void => {
  logger.info({ signal }, "shutting down");
  rooms.close();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  server.closeAllConnections();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
