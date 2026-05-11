// @atlasdraw/storage — Phase 4 T18: /health endpoint.
//
// Liveness probe for compose stacks, load balancers, and the Show HN demo
// "is the server up" check. Returns 200 unconditionally if the process is
// serving HTTP; readiness for storage I/O is implicit via 5xx on actual
// /maps requests.

import type { FastifyInstance } from "fastify";
import type { StorageMode } from "../types";

export function registerHealthRoute(
  app: FastifyInstance,
  storageMode: StorageMode,
): void {
  app.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    storageMode,
  }));
}
