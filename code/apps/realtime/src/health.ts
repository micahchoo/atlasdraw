// SPDX-License-Identifier: AGPL-3.0-only
// GET /health: {"status":"ok","rooms":N,"connections":M}.

import type { RoomServer } from "./rooms.js";
import type http from "http";

export function registerHealth(
  server: http.Server,
  rooms: Pick<RoomServer, "rooms" | "connections">,
): void {
  server.on("request", (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          rooms: rooms.rooms(),
          connections: rooms.connections(),
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
}
