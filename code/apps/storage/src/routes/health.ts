// @atlasdraw/storage — Phase 4 T18: /health endpoint.
//
// Readiness probe for compose stacks, load balancers, and the Show HN demo
// "is the server up" check. Pings the storage adapter's actual dependencies
// (DB, and blob store for postgres-minio) — a stopped postgres/minio
// container now surfaces as a 503 here instead of a fake 200 (ISSUES.md
// Issue 8; NEGSPACE.md).

import type { FastifyInstance } from "fastify";
import type { StorageClient, StorageMode } from "../types";

export function registerHealthRoute(
  app: FastifyInstance,
  storageMode: StorageMode,
  client: StorageClient,
): void {
  app.get("/health", async (_request, reply) => {
    try {
      await client.ping();
      return { status: "ok", uptime: process.uptime(), storageMode };
    } catch (err) {
      reply.status(503);
      return {
        status: "error",
        uptime: process.uptime(),
        storageMode,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
