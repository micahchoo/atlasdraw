// @atlasdraw/storage — Phase 4 T3 entry point.
//
// Fastify HTTP server with two adapters (postgres-minio + sqlite-fs). The
// adapter is picked from STORAGE_MODE env at startup; both implement the
// StorageClient contract from ./types so routes are adapter-agnostic.

import * as Sentry from "@sentry/node";
import Fastify from "fastify";
import { createPostgresMinioAdapter } from "./adapters/postgres-minio";
import { createSqliteFsAdapter } from "./adapters/sqlite-fs";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { registerQuotaMiddleware } from "./middleware/quota";
import { registerWorkspaceMiddleware } from "./middleware/workspace";
import { registerBillingRoutes } from "./routes/billing";
import { registerHealthRoute } from "./routes/health";
import { registerMapRoutes } from "./routes/maps";
import { registerShareRoutes } from "./routes/share";
import { registerWorkspaceRoutes } from "./routes/workspaces";

export * from "./middleware/workspace";

export * from "./types";
export * from "./config";

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
          delete event.request.headers["authorization"];
          delete event.request.headers["Authorization"];
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
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 50 * 1024 * 1024, // 50 MiB
  });

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

  registerHealthRoute(app, config.STORAGE_MODE);
  // Phase 6 A9: workspace middleware runs as a global preHandler. It
  // bypasses /health internally and either requires (managed) or attaches
  // (self-host) `X-Workspace-ID` for every other route.
  registerWorkspaceMiddleware(app, { managed: config.MANAGED_MODE });
  // Phase 6 A13b: quota guard runs after the workspace middleware. In
  // self-host it's a no-op; in managed mode it 402s POST /maps when the
  // workspace's map count would exceed its plan cap.
  registerQuotaMiddleware(app, {
    managed: config.MANAGED_MODE,
    client,
    limits: {
      free: config.QUOTA_FREE_MAPS,
      pro: config.QUOTA_PRO_MAPS,
      pro_25: config.QUOTA_PRO_MAPS,
    },
  });
  registerMapRoutes(app, client);
  registerShareRoutes(app, client, config.PUBLIC_URL);
  // Phase 6 A13b/A13c: workspaces + billing routes. Both 404 in
  // self-host. Billing routes also 503 in managed mode if Stripe env
  // isn't fully configured (don't fail boot — fail at request time).
  registerWorkspaceRoutes(app, {
    managed: config.MANAGED_MODE,
    client,
  });
  registerBillingRoutes(app, {
    managed: config.MANAGED_MODE,
    client,
    stripeSecretKey: config.STRIPE_SECRET_KEY,
    stripeWebhookSecret: config.STRIPE_WEBHOOK_SECRET,
    stripePricePro: config.STRIPE_PRICE_PRO,
    stripePricePro25: config.STRIPE_PRICE_PRO_25,
    siteUrl: config.SITE_URL,
  });

  await app.listen({ host: "0.0.0.0", port: config.PORT });
  app.log.info(
    `Storage started in ${config.STORAGE_MODE} mode on :${config.PORT}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
