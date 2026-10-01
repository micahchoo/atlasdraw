// @atlasdraw/storage — entry point.
//
// Reads the config, picks the adapter (STORAGE_MODE), builds the app
// (app.ts) and listens. On SIGTERM or SIGINT it closes the app: requests in
// flight finish first, then the store closes. A shutdown that takes longer
// than SHUTDOWN_TIMEOUT_MS exits anyway; a write cut there leaves the old
// map whole (see the adapters).

import * as Sentry from "@sentry/node";

import { createPostgresMinioAdapter } from "./adapters/postgres-minio";
import { createSqliteFsAdapter } from "./adapters/sqlite-fs";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { logger } from "./logger";

async function main(): Promise<void> {
  const config = loadConfig();

  // Opt-in Sentry. No-op when SENTRY_DSN is unset; see ADR-0009. beforeSend
  // drops the Authorization header and the client address.
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

  const client =
    config.STORAGE_MODE === "sqlite-fs"
      ? createSqliteFsAdapter({ dataDir: config.DATA_DIR })
      : createPostgresMinioAdapter({
          databaseUrl: config.DATABASE_URL,
          blobEndpoint: config.BLOB_ENDPOINT,
          blobAccessKey: config.BLOB_ACCESS_KEY,
          blobSecretKey: config.BLOB_SECRET_KEY,
          blobBucket: config.BLOB_BUCKET,
          blobRegion: config.BLOB_REGION,
        });

  const app = buildApp({ config, client });
  await app.listen({ host: "0.0.0.0", port: config.PORT });
  app.log.info(
    `Storage started in ${config.STORAGE_MODE} mode on :${config.PORT}`,
  );

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    app.log.info(`Received ${signal}; draining requests, then closing`);
    setTimeout(() => {
      app.log.warn("shutdown timed out; exiting with requests in flight");
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT_MS).unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, "shutdown failed");
        process.exit(1);
      },
    );
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
