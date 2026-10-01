// @atlasdraw/storage — Phase 4 T3 entry point.
//
// Fastify HTTP server with two adapters (postgres-minio + sqlite-fs). The
// adapter is picked from STORAGE_MODE env at startup; both implement the
// StorageClient contract from ./types so routes are adapter-agnostic.

import * as Sentry from "@sentry/node";
import Fastify, { type FastifyInstance } from "fastify";

import { createPostgresMinioAdapter } from "./adapters/postgres-minio";
import { createSqliteFsAdapter } from "./adapters/sqlite-fs";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { registerRateLimitMiddleware } from "./middleware/rate-limit";
import { registerHealthRoute } from "./routes/health";
import { registerMapRoutes } from "./routes/maps";
import { registerShareRoutes } from "./routes/share";

async function main(): Promise<void> {
  const config = loadConfig();

  // T18: opt-in Sentry. No-op when SENTRY_DSN is unset; see ADR-0009.
  // beforeSend scrubs Authorization headers and request IPs — operators who
  // wire this DSN should still document the data flow in their privacy notice.
  if (config.SENTRY_DSN) {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      beforeSend(event) {
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.Authorization;
        }
        if (event.user?.ip_address) {
          delete event.user.ip_address;
        }
        return event;
      },
    });
    logger.info("Sentry initialized");
  }

  // Fastify v5: pass a pre-built pino instance via loggerInstance, not
  // logger. The `logger` key only accepts boolean | pino-options-object
  // and rejects an instantiated logger with FST_ERR_LOG_INVALID_LOGGER_CONFIG.
  // Assert to the plain FastifyInstance. The concrete instance Fastify()
  // infers from `loggerInstance` carries a specific pino Logger generic that
  // is structurally incompatible with the FastifyInstance param every
  // registerX(app, …) helper takes — a known Fastify-v5 typing friction. The
  // instance is compatible at runtime; the assertion collapses the spurious
  // variance error that otherwise fires at each registration call site.
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 50 * 1024 * 1024, // 50 MiB
    // `request.ip` feeds the rate limiter. See TRUST_PROXY in config.ts.
    trustProxy: config.TRUST_PROXY,
  }) as unknown as FastifyInstance;

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );

  const client =
    config.STORAGE_MODE === "sqlite-fs"
      ? createSqliteFsAdapter({ dataDir: config.DATA_DIR })
      : createPostgresMinioAdapter({
          databaseUrl: config.DATABASE_URL,
          blobEndpoint: config.BLOB_ENDPOINT,
          blobAccessKey: config.BLOB_ACCESS_KEY,
          blobSecretKey: config.BLOB_SECRET_KEY,
        });

  registerHealthRoute(app, config.STORAGE_MODE, client);
  // Per-IP rate limit for the internet-facing HTTP API (SECURITY.md row 7).
  // onRequest hook — runs before body parsing; /health is exempt internally.
  registerRateLimitMiddleware(app, {
    max: config.RATE_LIMIT_MAX,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
  });
  registerMapRoutes(app, client);
  registerShareRoutes(app, client, config.PUBLIC_URL);

  // Wire Sentry into Fastify error handling. Sentry is opt-in (no-op when
  // SENTRY_DSN is unset); captureException is a no-op if init was skipped.
  app.setErrorHandler((error, _request, reply) => {
    Sentry.captureException(error);
    const err = error as { statusCode?: number; message?: string };
    reply.status(err.statusCode || 500).send({
      error: err.message || "Internal Server Error",
    });
  });

  await app.listen({ host: "0.0.0.0", port: config.PORT });
  app.log.info(
    `Storage started in ${config.STORAGE_MODE} mode on :${config.PORT}`,
  );

  // Graceful shutdown: close the adapter (DB pools, blob clients) then
  // close the HTTP server so in-flight requests drain before exit.
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal} — shutting down`);
    await client.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    Sentry.captureException(err);
    process.exit(1);
  });
}
