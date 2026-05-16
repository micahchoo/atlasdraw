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
  // server runs identically without any third-party data egress. Hosted
  // operators opt in by setting this env (see ADR-0009).
  SENTRY_DSN: z.string().optional(),
  // Phase 6 A9: hosted-mode flag. When `MANAGED_MODE=true` the workspace
  // middleware requires `X-Workspace-ID` on protected routes and route
  // handlers emit `workspace_scoped` events per ADR-0011. Default false
  // preserves self-host behaviour identically to Phase 4.
  MANAGED_MODE: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === "boolean") return v;
      if (typeof v !== "string") return false;
      return v.toLowerCase() === "true" || v === "1";
    }),
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

function formatZodError(
  err: z.ZodError,
  env: NodeJS.ProcessEnv,
): string {
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
    return `Invalid env var STORAGE_MODE: ${JSON.stringify(env.STORAGE_MODE)}. Expected one of "postgres-minio" | "sqlite-fs".`;
  }
  return `Invalid env var ${varName}: ${issue.message}`;
}
