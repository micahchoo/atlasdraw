import { z } from "zod";
import type { RealtimeConfig } from "@atlasdraw/protocol";

const BuildTargetSchema = z.enum(["pages", "local-only", "hosted"]);
export type BuildTarget = z.infer<typeof BuildTargetSchema>;

const EnvSchema = z.object({
  VITE_BUILD_TARGET: BuildTargetSchema.default("local-only"),
  // T13: storage HTTP base URL. Empty string = same-origin (production deploy
  // behind a reverse proxy). Only consulted when buildTarget === "hosted".
  VITE_STORAGE_BASE_URL: z.string().default(""),
  // Phase 5 T2: realtime feature flag + WebSocket URL. Both are Vite build-time
  // env vars injected by the compose file from config.toml values.
  VITE_REALTIME_ENABLED: z
    .enum(["true", "false"])
    .default("false"),
  VITE_REALTIME_WS_URL: z.string().default(""),
});

export type AppConfig = {
  buildTarget: BuildTarget;
  enableShareUI: boolean;
  /** Phase 5+: typed feature-flag. When `enabled` is false the collab client
   *  never opens a WebSocket and collab UI components render null. */
  realtime: RealtimeConfig;
  enableBackendPersistence: boolean;
  showDemoBadge: boolean;
  /**
   * Base URL for the storage HTTP API (e.g. "http://localhost:4000"). Empty
   * string means same-origin. Only meaningful when buildTarget === "hosted";
   * otherwise it's set but unused (`enableBackendPersistence` is false).
   */
  storageBaseUrl: string;
};

export function loadAppConfig(
  rawTarget: string | undefined = import.meta.env.VITE_BUILD_TARGET,
  rawStorageBaseUrl: string | undefined = import.meta.env.VITE_STORAGE_BASE_URL,
  rawRealtimeEnabled: string | undefined = import.meta.env.VITE_REALTIME_ENABLED,
  rawRealtimeWsUrl: string | undefined = import.meta.env.VITE_REALTIME_WS_URL,
): AppConfig {
  const parsed = EnvSchema.safeParse({
    VITE_BUILD_TARGET: rawTarget,
    VITE_STORAGE_BASE_URL: rawStorageBaseUrl,
    VITE_REALTIME_ENABLED: rawRealtimeEnabled,
    VITE_REALTIME_WS_URL: rawRealtimeWsUrl,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid env var ${issue.path.join(".")}: ${issue.message}. ` +
        `Expected one of "pages" | "local-only" | "hosted" (got ${JSON.stringify(rawTarget)}).`,
    );
  }
  const buildTarget = parsed.data.VITE_BUILD_TARGET;
  // Realtime is only available on hosted builds; the env flag gates it within
  // that tier. Pages + local-only never have a realtime relay to connect to.
  const realtimeEnabled =
    buildTarget === "hosted" && parsed.data.VITE_REALTIME_ENABLED === "true";
  const wsUrl = parsed.data.VITE_REALTIME_WS_URL || undefined;
  return {
    buildTarget,
    enableShareUI: buildTarget === "hosted",
    realtime: { enabled: realtimeEnabled, wsUrl },
    enableBackendPersistence: buildTarget === "hosted",
    showDemoBadge: buildTarget === "pages",
    storageBaseUrl: parsed.data.VITE_STORAGE_BASE_URL,
  };
}

let cached: AppConfig | undefined;

export function getAppConfig(): AppConfig {
  if (!cached) {
    cached = loadAppConfig();
  }
  return cached;
}

// Test-only — never call from production paths.
export function __resetAppConfigForTests(): void {
  cached = undefined;
}
