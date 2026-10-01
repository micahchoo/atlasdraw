// Test support: the production app on a real SQLite store in a temp dir.
// Every route test goes through `buildApp`, so the error handler, the
// limiters, the proxy setting and the shutdown order are the ones that ship.

import { Writable } from "node:stream";

import * as tmp from "tmp";

import { buildApp } from "./app";
import { createSqliteFsAdapter } from "./adapters/sqlite-fs";
import { loadConfig } from "./config";
import { createLogger } from "./logger";

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config";
import type { StorageClient } from "./types";

// Temp dirs made here go when the test process exits.
tmp.setGracefulCleanup();

export const OCTETS = { "content-type": "application/octet-stream" };

export function bearer(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

/** A sqlite-fs config read through `loadConfig`, as production reads it. */
export function sqliteConfig(
  dataDir: string,
  env: Record<string, string> = {},
): AppConfig {
  return loadConfig({
    STORAGE_MODE: "sqlite-fs",
    DATA_DIR: dataDir,
    // Tests make many requests from one address; a test of a limit sets it.
    RATE_LIMIT_MAX: "0",
    ...env,
  });
}

/** Log lines a test can read back. */
export class LogCapture {
  readonly lines: string[] = [];
  readonly stream = new Writable({
    write: (chunk, _enc, done) => {
      this.lines.push(String(chunk));
      done();
    },
  });
  text(): string {
    return this.lines.join("");
  }
}

export interface TestApp {
  app: FastifyInstance;
  client: StorageClient;
  dataDir: string;
  log: LogCapture;
}

/** The production app on a new temp dir. `close()` the app; the dir goes on exit. */
export function makeTestApp(
  env: Record<string, string> = {},
  opts: { dataDir?: string; client?: StorageClient } = {},
): TestApp {
  const dataDir = opts.dataDir ?? tmp.dirSync({ unsafeCleanup: true }).name;
  const config = sqliteConfig(dataDir, env);
  const client = opts.client ?? createSqliteFsAdapter({ dataDir });
  const log = new LogCapture();
  const app = buildApp({
    config,
    client,
    logger: createLogger("info", log.stream),
  });
  return { app, client, dataDir, log };
}
