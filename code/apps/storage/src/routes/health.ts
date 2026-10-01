// @atlasdraw/storage — /health endpoint.
//
// Readiness probe for compose stacks and load balancers. Pings the storage
// adapter's actual dependencies (DB, and blob store for postgres-minio), so a
// stopped postgres/minio container answers 503, not 200.

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
