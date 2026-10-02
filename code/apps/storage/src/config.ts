import { z } from "zod";

import type { StorageMode } from "./types";

// @atlasdraw/storage — startup config + StorageMode detection.
//
// Reads env at server boot and selects which adapter loads. A misconfiguration
// fails loudly and names the variable (see formatZodError), so a first run
// with a wrong env is obvious, not cryptic.

const BaseSchema = z.object({
  STORAGE_MODE: z.enum(["postgres-minio", "sqlite-fs"]),
  PORT: z.coerce.number().int().positive().default(4000),
  // Prefix for share URLs returned by POST /maps/:id/share. Empty
  // default → relative `/m/<token>` (works when storage is reverse-proxied
  // on the same origin as atlas-app). Operators override in compose env
  // for absolute URLs (e.g. `https://atlas.example.com`).
  PUBLIC_URL: z.string().default(""),
  // Structured-log level for pino. Standard pino levels apply
  // ("fatal","error","warn","info","debug","trace","silent").
  LOG_LEVEL: z.string().default("info"),
  // Optional Sentry DSN. When unset, Sentry init is a no-op — the
  // server runs identically without any third-party data egress. An
  // operator opts in by setting this env
  // (see docs/architecture/adr/0009-error-capture.md).
  SENTRY_DSN: z.string().optional(),
  // Which proxies may set X-Forwarded-For (Fastify `trustProxy`). Off by
  // default: with no proxy in front, a client could otherwise choose its own
  // IP and step around the rate limiter. Behind one reverse proxy, set "1".
  // Accepts "true", "false", a hop count, or a comma-separated IP/CIDR list.
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v): boolean | number | string => {
      if (v === undefined || v === "" || v.toLowerCase() === "false") {
        return false;
      }
      if (v.toLowerCase() === "true") {
        return true;
      }
      return /^\d+$/.test(v) ? Number(v) : v;
    }),
  // Per-IP fixed-window rate limit for the HTTP API. RATE_LIMIT_MAX requests
  // per RATE_LIMIT_WINDOW_MS window; /health is always exempt. Set
  // RATE_LIMIT_MAX=0 to disable (e.g. when an upstream proxy already throttles).
  // Defaults are generous — they exist to blunt abuse, not to shape normal use.
  RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  // The largest map one request may store, in bytes. A bigger body gets 413.
  // A proxy in front must allow at least this much (nginx client_max_body_size).
  MAX_MAP_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),
  // Requests one client address may have open at once; past it, 429. An
  // IPv6 client counts by its /64. 0: no limit.
  MAX_CONCURRENT_PER_IP: z.coerce.number().int().nonnegative().default(16),
  // A connection with no bytes moving either way for this long is closed: a
  // body that stops arriving, or a reader that stops reading.
  IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // The longest a client may take to send a whole request, body included.
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300_000),
  // The cap on the sum of all stored map sizes, in bytes, writes in flight
  // included. A create or a write that would pass it gets 507. POST /maps is
  // open to anyone who reaches the API, so the default is a cap, not none:
  // 10 GiB. 0: no cap.
  MAX_TOTAL_BYTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(10 * 1024 * 1024 * 1024),
  // New maps one client address may create per NEW_MAPS_WINDOW_MS (an IPv6
  // client counts by its /64); past it, 429. 0: no limit.
  MAX_NEW_MAPS_PER_IP: z.coerce.number().int().nonnegative().default(60),
  NEW_MAPS_WINDOW_MS: z.coerce.number().int().positive().default(3_600_000),
  // Maps stored before write keys (no key: nobody can write them) are kept
  // for this many days after the upgrade that added keys, then deleted by
  // the sweep once no live share link reads them. 0: at the next sweep.
  LEGACY_MAP_GRACE_DAYS: z.coerce.number().int().nonnegative().default(90),
  // How often the server deletes expired share tokens and the keyless maps
  // that no live token reads (see StorageClient.sweep). It also sweeps once at
  // start. 0: never.
  SWEEP_INTERVAL_MS: z.coerce.number().int().nonnegative().default(3_600_000),
  // Earlier versions of each map the server keeps, besides its latest bytes
  // (docs/architecture/adr/0020-server-version-history.md). They count
  // against MAX_TOTAL_BYTES. 0: no history; a frozen link still keeps the
  // version it shows.
  MAP_VERSIONS_KEPT: z.coerce.number().int().nonnegative().default(20),
  // The least time between two kept versions. The editor saves every few
  // seconds while the owner draws; a save that stood for less than this,
  // and came less than this after the last kept version, is replaced by the
  // next one. 0: keep every save.
  MAP_VERSION_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(10),
  // How long a shutdown waits for requests in flight before it exits anyway.
  // Keep it below the container's stop grace period (compose: 30 s).
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
});

const PostgresMinioSchema = BaseSchema.extend({
  STORAGE_MODE: z.literal("postgres-minio"),
  DATABASE_URL: z.string().min(1),
  BLOB_ENDPOINT: z.string().min(1),
  BLOB_ACCESS_KEY: z.string().min(1),
  BLOB_SECRET_KEY: z.string().min(1),
  // The bucket and its region. The adapter makes the bucket if it does not
  // exist; a name another account owns is an error.
  BLOB_BUCKET: z.string().min(3).default("atlasdraw-maps"),
  BLOB_REGION: z.string().min(1).default("us-east-1"),
  // Path-style URLs (endpoint/bucket/key) suit most self-hosted S3 servers.
  // Set "false" for virtual-hosted URLs (bucket.endpoint/key), as AWS prefers.
  BLOB_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const SqliteFsSchema = BaseSchema.extend({
  STORAGE_MODE: z.literal("sqlite-fs"),
  DATA_DIR: z.string().min(1).default("/data"),
});

const AppConfigSchema = z.discriminatedUnion("STORAGE_MODE", [
  PostgresMinioSchema,
  SqliteFsSchema,
]);

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = AppConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error, env));
  }
  return parsed.data;
}

function formatZodError(err: z.ZodError, env: NodeJS.ProcessEnv): string {
  const mode = env.STORAGE_MODE as StorageMode | undefined;
  const issue = err.issues[0];
  const varName = String(issue.path[issue.path.length - 1] ?? "<unknown>");
  if (issue.code === "invalid_type" && issue.received === "undefined") {
    return mode
      ? `Missing required env var: ${varName} (required when STORAGE_MODE=${mode})`
      : `Missing required env var: ${varName}`;
  }
  if (
    issue.code === "invalid_enum_value" ||
    issue.code === "invalid_union_discriminator"
  ) {
    return `Invalid env var STORAGE_MODE: ${JSON.stringify(
      env.STORAGE_MODE,
    )}. Expected one of "postgres-minio" | "sqlite-fs".`;
  }
  return `Invalid env var ${varName}: ${issue.message}`;
}
