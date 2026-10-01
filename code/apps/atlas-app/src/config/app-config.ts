// SPDX-License-Identifier: AGPL-3.0-only
//
// The app's configuration: every VITE_* variable, read through one schema.
// Vite puts the variables in import.meta.env at build time. Read them through
// getAppConfig(), never import.meta.env, so a wrong value fails at boot with
// the name of the variable.

import { z } from "zod";

import { normalizeBase } from "../routes";

const BuildTargetSchema = z.enum(["pages", "local-only", "hosted"]);
export type BuildTarget = z.infer<typeof BuildTargetSchema>;

const Flag = z.enum(["true", "false"]);

const EnvSchema = z.object({
  VITE_BUILD_TARGET: BuildTargetSchema.default("local-only"),
  // The storage HTTP API. Empty: the same origin, behind a reverse proxy.
  // Read only when the build target is "hosted".
  VITE_STORAGE_BASE_URL: z.string().default(""),
  // Rooms, and the relay's WebSocket URL. Rooms need a hosted build too.
  VITE_REALTIME_ENABLED: Flag.default("false"),
  VITE_REALTIME_WS_URL: z.string().default(""),
  // The Maputnik editor for "Edit basemap style".
  VITE_MAPUTNIK_URL: z.string().default("https://maputnik.github.io/editor/"),
  // A Photon-compatible geocoder. Empty by default: no call-home
  // (ADR-0006, ADR-0011).
  VITE_GEOCODER_ENDPOINT: z.string().default(""),
  // Remote basemap tiles (OpenFreeMap, OSM). On by default; see ADR-0006
  // "Update (2026-06-13)".
  VITE_ALLOW_REMOTE_BASEMAPS: Flag.default("true"),
  // The /embed route. On by default.
  VITE_EMBED_ENABLED: Flag.default("true"),
  // The offline basemap archive. Default: data/ under the base path.
  VITE_PMTILES_PATH: z.string().optional(),
  VITE_APP_VERSION: z.string().default("unknown"),
  VITE_GIT_HASH: z.string().default("unknown"),
  // Set by Vite: the path the build serves under.
  BASE_URL: z.string().default("/"),
});

/** Whether rooms are offered, and where the relay is. */
export type RealtimeConfig = {
  enabled: boolean;
  /** The relay's base URL; same origin when unset. */
  wsUrl?: string;
};

export type AppConfig = {
  buildTarget: BuildTarget;
  /** When `enabled` is false no room is joined and no collab UI shows. */
  realtime: RealtimeConfig;
  enableBackendPersistence: boolean;
  showDemoBadge: boolean;
  /** The storage HTTP API; empty means the same origin. Hosted builds only. */
  storageBaseUrl: string;
  /** The Maputnik editor for "Edit basemap style". */
  maputnikUrl: string;
  /** The geocoder; undefined means geocoding is off and nothing is fetched. */
  geocoder?: { endpoint: string };
  allowRemoteBasemaps: boolean;
  /** Whether /embed shows the viewer; otherwise it opens the editor. */
  embedEnabled: boolean;
  /** The URL of the offline basemap archive. */
  pmtilesPath: string;
  appVersion: string;
  gitHash: string;
};

export type Env = Record<string, string | boolean | undefined>;

/** The config from a set of env variables. Throws, naming the bad variable. */
export function loadAppConfig(env: Env = import.meta.env): AppConfig {
  const known = Object.fromEntries(
    Object.keys(EnvSchema.shape).map((key) => [
      key,
      typeof env[key] === "string" ? env[key] : undefined,
    ]),
  );
  const parsed = EnvSchema.safeParse(known);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const name = String(issue.path[0]);
    throw new Error(
      `Invalid ${name}=${JSON.stringify(known[name])}: ${issue.message}`,
    );
  }
  const e = parsed.data;
  const buildTarget = e.VITE_BUILD_TARGET;
  // Rooms need a relay, and only a hosted build has one.
  const realtimeEnabled =
    buildTarget === "hosted" && e.VITE_REALTIME_ENABLED === "true";
  const geocoderEndpoint = e.VITE_GEOCODER_ENDPOINT.trim();
  return {
    buildTarget,
    realtime: {
      enabled: realtimeEnabled,
      wsUrl: e.VITE_REALTIME_WS_URL || undefined,
    },
    enableBackendPersistence: buildTarget === "hosted",
    showDemoBadge: buildTarget === "pages",
    storageBaseUrl: e.VITE_STORAGE_BASE_URL,
    maputnikUrl: e.VITE_MAPUTNIK_URL,
    geocoder:
      geocoderEndpoint === "" ? undefined : { endpoint: geocoderEndpoint },
    allowRemoteBasemaps: e.VITE_ALLOW_REMOTE_BASEMAPS === "true",
    embedEnabled: e.VITE_EMBED_ENABLED === "true",
    pmtilesPath:
      e.VITE_PMTILES_PATH ??
      `${normalizeBase(e.BASE_URL)}data/world-low-zoom.pmtiles`,
    appVersion: e.VITE_APP_VERSION,
    gitHash: e.VITE_GIT_HASH,
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
