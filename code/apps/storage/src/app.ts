// @atlasdraw/storage — the composed HTTP app.
//
// `buildApp` is the one place the server is put together, and both
// production (index.ts) and the tests call it. So the error handler, the
// limiters, the proxy setting, the start-up sweep and the shutdown order that
// the tests check are the ones that ship.
//
// Shutdown: `app.close()` stops new connections, lets requests in flight
// finish, and only then (onClose) stops the sweep and closes the store.

import * as Sentry from "@sentry/node";
import Fastify, { type FastifyInstance } from "fastify";

import { createLogger } from "./logger";
import { registerInFlightLimit } from "./middleware/in-flight";
import { registerRateLimitMiddleware } from "./middleware/rate-limit";
import { registerBlobBodyParser } from "./routes/blob-body";
import { registerHealthRoute } from "./routes/health";
import { registerMapRoutes } from "./routes/maps";
import { registerShareRoutes } from "./routes/share";
import { registerVersionRoutes } from "./routes/versions";
import { createMapService } from "./service/maps";

import type { Logger } from "pino";
import type { AppConfig } from "./config";
import type { StorageClient } from "./types";

declare module "fastify" {
  interface FastifyInstance {
    /** Resolves when the sweep that is running, if any, has finished. */
    sweepIdle(): Promise<void>;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  client: StorageClient;
  /** Default: a logger at `config.LOG_LEVEL` on stdout. */
  logger?: Logger;
  now?: () => Date;
}

/** A failed start-up sweep is tried again after this long, not an hour. */
const SWEEP_RETRY_MS = 30_000;

/** The longest a client may take to send its request headers. */
const HEADERS_TIMEOUT_MS = 20_000;

export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const { config, client } = opts;

  // Fastify v5 takes a built pino instance as `loggerInstance`. The instance
  // type it infers carries a pino generic that the registerX(app) helpers'
  // plain FastifyInstance does not accept, so the result is asserted to it.
  const app = Fastify({
    loggerInstance: opts.logger ?? createLogger(config.LOG_LEVEL),
    // JSON bodies only (share expiry); map bytes stream (blob-body.ts).
    bodyLimit: 64 * 1024,
    // `request.ip` feeds the limiters. See TRUST_PROXY in config.ts.
    trustProxy: config.TRUST_PROXY,
    // Socket idle: no bytes either way. Ends a stalled upload or a reader
    // that stopped reading.
    connectionTimeout: config.IDLE_TIMEOUT_MS,
    // The whole request, body included.
    requestTimeout: config.REQUEST_TIMEOUT_MS,
  }) as unknown as FastifyInstance;
  app.server.headersTimeout = Math.min(
    HEADERS_TIMEOUT_MS,
    config.REQUEST_TIMEOUT_MS,
  );

  registerBlobBodyParser(app, config.MAX_MAP_BYTES);

  const service = createMapService(client, {
    maxTotalBytes: config.MAX_TOTAL_BYTES,
    legacyGraceDays: config.LEGACY_MAP_GRACE_DAYS,
    versions: {
      keep: config.MAP_VERSIONS_KEPT,
      intervalMs: config.MAP_VERSION_INTERVAL_MINUTES * 60_000,
    },
    now: opts.now,
  });

  registerHealthRoute(app, config.STORAGE_MODE, client);
  registerRateLimitMiddleware(app, {
    max: config.RATE_LIMIT_MAX,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
  });
  registerInFlightLimit(app, config.MAX_CONCURRENT_PER_IP);
  registerMapRoutes(app, service, {
    maxNewMaps: config.MAX_NEW_MAPS_PER_IP,
    windowMs: config.NEW_MAPS_WINDOW_MS,
  });
  registerVersionRoutes(app, service);
  registerShareRoutes(app, service, config.PUBLIC_URL);

  // A 4xx carries Fastify's own message (body too large, bad JSON): it names
  // the client's mistake. A 5xx carries nothing; the detail goes to the log
  // and, when SENTRY_DSN is set, to Sentry.
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      Sentry.captureException(error);
      request.log.error({ err: error }, "request failed");
      return reply.status(500).send({ error: "internal error" });
    }
    return reply
      .status(status)
      .send({ error: (error as Error).message || "bad request" });
  });

  // Expired share tokens and unreachable maps go at start and on an interval.
  let sweepTimer: NodeJS.Timeout | null = null;
  let running: Promise<void> = Promise.resolve();
  let closing = false;
  const sweep = (): void => {
    if (closing) {
      return;
    }
    running = service
      .sweep()
      .then((swept) => {
        if (Object.values(swept).some((n) => n > 0)) {
          app.log.info({ swept }, "storage sweep");
        }
      })
      .catch((err: unknown) => {
        app.log.warn({ err }, "storage sweep failed; trying again soon");
        if (!closing) {
          setTimeout(sweep, SWEEP_RETRY_MS).unref();
        }
      });
  };
  app.decorate("sweepIdle", () => running);
  app.addHook("onReady", async () => {
    sweep();
    if (config.SWEEP_INTERVAL_MS > 0) {
      sweepTimer = setInterval(sweep, config.SWEEP_INTERVAL_MS);
      sweepTimer.unref();
    }
  });
  // A response sent after the shutdown began closes its connection, so a
  // keep-alive client (a proxy, usually) cannot hold the shutdown open.
  app.addHook("preClose", async () => {
    closing = true;
  });
  app.addHook("onSend", async (_request, reply) => {
    if (closing) {
      reply.header("Connection", "close");
    }
  });
  app.addHook("onClose", async () => {
    closing = true;
    if (sweepTimer) {
      clearInterval(sweepTimer);
    }
    await running;
    await client.close();
  });

  return app;
}
