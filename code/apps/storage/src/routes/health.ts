// @atlasdraw/storage — /health.
//
// Readiness probe for compose, load balancers and operators. It pings the
// adapter's real dependencies (the database, and the blob store for
// postgres-minio), so a stopped dependency shows as 503, not a false 200.
//
// The probe is open to anyone who reaches the API, so a failure answers with
// no detail. The cause goes to the log.

import type { FastifyInstance } from "fastify";
import type { StorageClient, StorageMode } from "../types";

export function registerHealthRoute(
  app: FastifyInstance,
  storageMode: StorageMode,
  client: StorageClient,
): void {
  app.get("/health", async (request, reply) => {
    try {
      await client.ping();
      return { status: "ok", uptime: process.uptime(), storageMode };
    } catch (err) {
      request.log.error({ err }, "health check failed");
      reply.status(503);
      return { status: "error", uptime: process.uptime(), storageMode };
    }
  });
}
