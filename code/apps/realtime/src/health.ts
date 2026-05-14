// SPDX-License-Identifier: AGPL-3.0-only
// Health endpoint for the realtime relay.
// Returns {"status":"ok","connections":N} where N is the current Socket.IO
// connected count. Returns N=0 while Socket.IO event handlers are stubbed.
// TODO Phase 5 Task 5: wire Socket.IO serverStats to supply real connection count.

import type http from "http";

/**
 * Register a GET /health handler on the provided HTTP server.
 * During the stub phase, `connections` is always 0.
 */
export function registerHealth(server: http.Server): void {
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", connections: 0 }));
    }
    // For non-/health paths, do nothing — Socket.IO processes them.
  });
}
