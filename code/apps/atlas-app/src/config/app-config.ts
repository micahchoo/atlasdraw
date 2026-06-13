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
  VITE_REALTIME_ENABLED: z.enum(["true", "false"]).default("false"),
  VITE_REALTIME_WS_URL: z.string().default(""),
  // Phase 6 A4: Maputnik base URL for the "Edit basemap style" modal. Default
  // points at the public Maputnik instance; self-hosters who don't want the
  // public Maputnik can point this at a self-hosted instance.
  VITE_MAPUTNIK_URL: z.string().default("https://maputnik.github.io/editor/"),
  // Phase 6 A8: Photon-compatible geocoder endpoint. EMPTY by default — no
  // call-home. Operators opt in by setting this to e.g.
  //   https://photon.komoot.io      (public, rate-limited)
  //   https://photon.self-host.lan  (their own instance)
  // See ADR-0006 / ADR-0011 (zero call-home, telemetry posture).
  VITE_GEOCODER_ENDPOINT: z.string().default(""),
  // Phase 6 A13a: managed-mode (hosted multi-tenant SaaS) flag. When "true"
  // the client surfaces the workspace switcher, the billing page, and other
  // managed-only UI. Defaults to "false" so self-hosters and the local-only
  // / pages tiers never see them. Cites ADR-0011 (hosted-mode telemetry,
  // server-side only) — the *client* surface is gated here.
  VITE_MANAGED_MODE: z.enum(["true", "false"]).default("false"),
  // T14/T15: allow remote basemap tile sources (e.g. OpenFreeMap, OSM).
  // Default TRUE as of 2026-06-13 (user decision) so the Bright/OSM basemaps
  // render out of the box. Operators opt OUT by setting this to "false".
  // NOTE: this is a deliberate deviation from ADR-0006's original
  // default-false posture — see ADR-0006 "Update (2026-06-13)".
  VITE_ALLOW_REMOTE_BASEMAPS: z.enum(["true", "false"]).default("true"),
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
  /**
   * Phase 6 A4: base URL of the Maputnik editor used by the "Edit basemap
   * style" modal. Defaults to the public instance
   * `https://maputnik.github.io/editor/`. Self-hosters who don't want the
   * public Maputnik can point this at a self-hosted instance via
   * `VITE_MAPUTNIK_URL`.
   */
  maputnikUrl: string;
  /**
   * Phase 6 A8: optional Photon-compatible geocoder endpoint. When the
   * field is `undefined`, geocoding is disabled and CSV imports behave
   * exactly as in Phase 3 (no fetch is ever issued). When set, the
   * MapEditor's CSV-import path constructs a `PhotonGeocoder` against this
   * URL. Operator-configured; ADR-0006 / ADR-0011 (zero call-home).
   */
  geocoder?: { endpoint: string };
  /**
   * Phase 6 A13a: managed-mode flag. True only on the multi-tenant SaaS
   * deploy; gates the workspace switcher, billing page, and other hosted-
   * only client UI. Self-host and local-only / pages tiers always see
   * `false` regardless of `buildTarget`. Cites ADR-0011.
   */
  managed: boolean;
  /** T14/T15: gate for remote basemap tile sources. Default true as of
   *  2026-06-13 (user decision); opt out with VITE_ALLOW_REMOTE_BASEMAPS=false. */
  allowRemoteBasemaps: boolean;
};

export function loadAppConfig(
  rawTarget: string | undefined = import.meta.env.VITE_BUILD_TARGET,
  rawStorageBaseUrl: string | undefined = import.meta.env.VITE_STORAGE_BASE_URL,
  rawRealtimeEnabled: string | undefined = import.meta.env
    .VITE_REALTIME_ENABLED,
  rawRealtimeWsUrl: string | undefined = import.meta.env.VITE_REALTIME_WS_URL,
  rawMaputnikUrl: string | undefined = import.meta.env.VITE_MAPUTNIK_URL,
  rawGeocoderEndpoint: string | undefined = import.meta.env
    .VITE_GEOCODER_ENDPOINT,
  rawManagedMode: string | undefined = import.meta.env.VITE_MANAGED_MODE,
  rawAllowRemoteBasemaps: string | undefined = import.meta.env
    .VITE_ALLOW_REMOTE_BASEMAPS,
): AppConfig {
  const parsed = EnvSchema.safeParse({
    VITE_BUILD_TARGET: rawTarget,
    VITE_STORAGE_BASE_URL: rawStorageBaseUrl,
    VITE_REALTIME_ENABLED: rawRealtimeEnabled,
    VITE_REALTIME_WS_URL: rawRealtimeWsUrl,
    VITE_MAPUTNIK_URL: rawMaputnikUrl,
    VITE_GEOCODER_ENDPOINT: rawGeocoderEndpoint,
    VITE_MANAGED_MODE: rawManagedMode,
    VITE_ALLOW_REMOTE_BASEMAPS: rawAllowRemoteBasemaps,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid env var ${issue.path.join(".")}: ${issue.message}. ` +
        `Expected one of "pages" | "local-only" | "hosted" (got ${JSON.stringify(
          rawTarget,
        )}).`,
    );
  }
  const buildTarget = parsed.data.VITE_BUILD_TARGET;
  // Realtime is only available on hosted builds; the env flag gates it within
  // that tier. Pages + local-only never have a realtime relay to connect to.
  const realtimeEnabled =
    buildTarget === "hosted" && parsed.data.VITE_REALTIME_ENABLED === "true";
  const wsUrl = parsed.data.VITE_REALTIME_WS_URL || undefined;
  const geocoderEndpoint = parsed.data.VITE_GEOCODER_ENDPOINT.trim();
  // Empty string → undefined (i.e. geocoder OFF). Zero call-home: when the
  // operator hasn't supplied an endpoint, no geocoder is constructed and
  // the CSV-import path makes no network calls. ADR-0006 / ADR-0011.
  const geocoder =
    geocoderEndpoint === "" ? undefined : { endpoint: geocoderEndpoint };
  // Managed-mode is hosted-only AND opt-in (operator sets VITE_MANAGED_MODE).
  // Self-host (`hosted` + managed off) gets the same backend persistence and
  // share UI but no workspace-switcher / billing surface — matches ADR-0011's
  // server-side `MANAGED_MODE=true` posture.
  const managed =
    buildTarget === "hosted" && parsed.data.VITE_MANAGED_MODE === "true";
  const allowRemoteBasemaps = parsed.data.VITE_ALLOW_REMOTE_BASEMAPS === "true";
  return {
    buildTarget,
    enableShareUI: buildTarget === "hosted",
    realtime: { enabled: realtimeEnabled, wsUrl },
    enableBackendPersistence: buildTarget === "hosted",
    showDemoBadge: buildTarget === "pages",
    storageBaseUrl: parsed.data.VITE_STORAGE_BASE_URL,
    maputnikUrl: parsed.data.VITE_MAPUTNIK_URL,
    geocoder,
    managed,
    allowRemoteBasemaps,
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
