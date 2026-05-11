// @atlasdraw/storage — Phase 4 T3 entry point.
//
// Fastify HTTP server with two adapters (postgres-minio + sqlite-fs). The
// adapter is picked from STORAGE_MODE env at startup; both implement the
// StorageClient contract from ./types so routes are adapter-agnostic.

import Fastify from "fastify";
import { createPostgresMinioAdapter } from "./adapters/postgres-minio";
import { createSqliteFsAdapter } from "./adapters/sqlite-fs";
import { loadConfig } from "./config";
import { registerMapRoutes } from "./routes/maps";
import { registerShareRoutes } from "./routes/share";

export * from "./types";
export * from "./config";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({
    logger: true,
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

  registerMapRoutes(app, client);
  registerShareRoutes(app, client, config.PUBLIC_URL);

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
