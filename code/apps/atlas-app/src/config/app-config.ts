import { z } from "zod";

const BuildTargetSchema = z.enum(["pages", "local-only", "hosted"]);
export type BuildTarget = z.infer<typeof BuildTargetSchema>;

const EnvSchema = z.object({
  VITE_BUILD_TARGET: BuildTargetSchema.default("local-only"),
  // T13: storage HTTP base URL. Empty string = same-origin (production deploy
  // behind a reverse proxy). Only consulted when buildTarget === "hosted".
  VITE_STORAGE_BASE_URL: z.string().default(""),
});

export type AppConfig = {
  buildTarget: BuildTarget;
  enableShareUI: boolean;
  enableRealtime: boolean;
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
): AppConfig {
  const parsed = EnvSchema.safeParse({
    VITE_BUILD_TARGET: rawTarget,
    VITE_STORAGE_BASE_URL: rawStorageBaseUrl,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid env var ${issue.path.join(".")}: ${issue.message}. ` +
        `Expected one of "pages" | "local-only" | "hosted" (got ${JSON.stringify(rawTarget)}).`,
    );
  }
  const buildTarget = parsed.data.VITE_BUILD_TARGET;
  return {
    buildTarget,
    enableShareUI: buildTarget === "hosted",
    enableRealtime: buildTarget === "hosted",
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
