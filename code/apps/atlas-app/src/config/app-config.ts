import { z } from "zod";

const BuildTargetSchema = z.enum(["pages", "local-only", "hosted"]);
export type BuildTarget = z.infer<typeof BuildTargetSchema>;

const EnvSchema = z.object({
  VITE_BUILD_TARGET: BuildTargetSchema.default("local-only"),
});

export type AppConfig = {
  buildTarget: BuildTarget;
  enableShareUI: boolean;
  enableRealtime: boolean;
  enableBackendPersistence: boolean;
  showDemoBadge: boolean;
};

export function loadAppConfig(
  rawTarget: string | undefined = import.meta.env.VITE_BUILD_TARGET,
): AppConfig {
  const parsed = EnvSchema.safeParse({ VITE_BUILD_TARGET: rawTarget });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid env var VITE_BUILD_TARGET: ${issue.message}. ` +
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
