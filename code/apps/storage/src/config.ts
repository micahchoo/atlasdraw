import { z } from "zod";

import type { StorageMode } from "./types";

// @atlasdraw/storage — Phase 4 T2: startup config + StorageMode detection.
//
// Reads env at server boot and selects which adapter loads. Failure mode is
// loud-and-named (see formatZodError) — Phase 4's first-run experience
// depends on misconfiguration being obvious instead of cryptic.

const BaseSchema = z.object({
  STORAGE_MODE: z.enum(["postgres-minio", "sqlite-fs"]),
  PORT: z.coerce.number().int().positive().default(4000),
  // T4: prefix for share URLs returned by POST /maps/:id/share. Empty
  // default → relative `/m/<token>` (works when storage is reverse-proxied
  // on the same origin as atlas-app). Operators override in compose env
  // for absolute URLs (e.g. `https://atlas.example.com`).
  PUBLIC_URL: z.string().default(""),
  // T18: structured-log level for pino. Standard pino levels apply
  // ("fatal","error","warn","info","debug","trace","silent").
  LOG_LEVEL: z.string().default("info"),
  // T18: optional Sentry DSN. When unset, Sentry init is a no-op — the
  // server runs identically without any third-party data egress. An
  // operator opts in by setting this env (see ADR-0009).
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
});

const PostgresMinioSchema = BaseSchema.extend({
  STORAGE_MODE: z.literal("postgres-minio"),
  DATABASE_URL: z.string().min(1),
  BLOB_ENDPOINT: z.string().min(1),
  BLOB_ACCESS_KEY: z.string().min(1),
  BLOB_SECRET_KEY: z.string().min(1),
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
