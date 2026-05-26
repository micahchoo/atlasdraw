// SPDX-License-Identifier: AGPL-3.0-only
// Health endpoint for the realtime relay.
// Returns {"status":"ok","connections":N} where N is the current Socket.IO
// connected count.

import type http from "http";
import type { Server as SocketIOServer } from "socket.io";

/**
 * Register a GET /health handler on the provided HTTP server.
 *
 * When an `io` instance is provided, `connections` reflects the real count of
 * currently connected Socket.IO clients (`io.engine.clientsCount`). When `io`
 * is omitted (e.g. during testing), `connections` defaults to 0.
 */
export function registerHealth(server: http.Server, io?: SocketIOServer): void {
  server.on(
    "request",
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.url === "/health" && req.method === "GET") {
        const connections = io?.engine?.clientsCount ?? 0;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", connections }));
      }
      // For non-/health paths, do nothing — Socket.IO processes them.
    },
  );
}
