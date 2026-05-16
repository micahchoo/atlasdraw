// SPDX-License-Identifier: MIT
// Phase 6 A11 — `.excalidrawlib` reader + built-in library index.
//
// Upstream schema reference:
//   code/packages/excalidraw/types.ts:532-541 — `LibraryItem` (v2)
//     { id: string; status: "published"|"unpublished";
//       elements: readonly NonDeleted<ExcalidrawElement>[];
//       created: number; name?: string; error?: string; }
//   code/packages/excalidraw/data/library.ts — `serializeLibraryAsJSON`
//     emits `{ type: "excalidrawlib", version: 2, source, libraryItems }`.
//
// We deliberately do NOT redefine `LibraryItem` — we import the upstream type
// from `@excalidraw/excalidraw` so atlas fixtures stay binary-compatible with
// any `.excalidrawlib` exported by Excalidraw itself, and a future fork-bump
// surfaces field changes as type errors.
//
// Phase 6 amended scope §A11 (cites Q-P6-1): the original §Task 14b spec
// referenced `AtlasdrawAPI.addAnnotation()` which is cut in v1.0. The atlas-app
// panel inserts items directly via `excalidrawAPI.updateLibrary` (Path A —
// extend Excalidraw's own library). This reader is unaware of insertion path.

import type { LibraryItem } from "@excalidraw/excalidraw/types";

/**
 * The on-disk shape of an `.excalidrawlib` file.
 *
 * Upstream calls this an "ExportedLibraryData" in `data/json.ts` but never
 * exports the type name. We define it locally to match the JSON shape exactly.
 */
export interface ExcalidrawLibrary {
  type: "excalidrawlib";
  /** Upstream v2 is the only supported version (v1 was a flat element array). */
  version: number;
  /** Library items in the order they should appear in the library UI. */
  libraryItems: LibraryItem[];
  /** Optional provenance string (e.g. "atlasdraw:wildfire-icons"). */
  source?: string;
}

/**
 * Returned by {@link parseLibraryFile} when the input string is not a valid
 * `.excalidrawlib` payload. We keep the raw string so callers can surface the
 * original input in an error UI / failure log without re-stringifying.
 */
export interface LibraryParseError {
  error: string;
  raw: string;
}

/**
 * Parse a `.excalidrawlib` JSON string.
 *
 * Returns either the parsed library or a {@link LibraryParseError}.
 * Failure modes covered:
 *  - syntactically invalid JSON
 *  - missing or non-array `libraryItems`
 *  - missing or wrong `type` field
 */
export function parseLibraryFile(
  json: string,
): ExcalidrawLibrary | LibraryParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      error: `parse error: ${e instanceof Error ? e.message : String(e)}`,
      raw: json,
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return { error: "parse error: payload is not an object", raw: json };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== "excalidrawlib") {
    return {
      error: `parse error: type field is ${JSON.stringify(obj.type)}, expected "excalidrawlib"`,
      raw: json,
    };
  }
  if (!Array.isArray(obj.libraryItems)) {
    return {
      error: "parse error: libraryItems field is missing or not an array",
      raw: json,
    };
  }
  // We deliberately do NOT deep-validate each LibraryItem here — that work
  // belongs to Excalidraw's `restoreLibraryItems` which runs inside
  // `excalidrawAPI.updateLibrary` and fills in defaults for partial elements.
  // A shallow shape check is sufficient to fail loudly on the wrong file type
  // (e.g. an `.excalidraw` scene file or random JSON), which is what callers
  // care about.
  return {
    type: "excalidrawlib",
    version: typeof obj.version === "number" ? obj.version : 2,
    libraryItems: obj.libraryItems as LibraryItem[],
    source: typeof obj.source === "string" ? obj.source : undefined,
  };
}

/**
 * Built-in library fixtures bundled with the atlas-app.
 *
 * Sourced from `code/packages/data/fixtures/libraries/*.excalidrawlib`.
 * Each fixture has a sibling `LICENSE.txt` declaring SPDX (MIT / ISC /
 * CC0-1.0 / Unlicense only — enforced by `scripts/check-license-libraries.sh`
 * per OQ7).
 *
 * Loading strategy:
 *  - Vite build (atlas-app): `import.meta.glob(..., { eager: true, query: '?raw', import: 'default' })`
 *    inlines the JSON strings at build time.
 *  - Vitest node env (this package's own tests): `import.meta.glob` is
 *    unavailable; we fall back to `fs.readFileSync` keyed off `import.meta.url`.
 *
 * Returns an empty array on read failure rather than throwing — callers
 * (the panel UI) treat a missing library as a no-op, not a fatal error.
 */
export function getBuiltInLibraries(): ExcalidrawLibrary[] {
  const sources = loadFixtureSources();
  const libs: ExcalidrawLibrary[] = [];
  for (const [path, raw] of sources) {
    const parsed = parseLibraryFile(raw);
    if ("error" in parsed) {
      // Skip malformed fixtures rather than throwing — the license-check
      // script is the gate for fixture correctness; this is a read path.
      // eslint-disable-next-line no-console
      console.warn(`asset-library: skipping malformed fixture ${path}: ${parsed.error}`);
      continue;
    }
    libs.push(parsed);
  }
  return libs;
}

/**
 * Internal: load raw fixture JSON strings keyed by relative path.
 *
 * Two execution contexts:
 *  1. Vite-driven build/dev (atlas-app consuming this package). `import.meta.glob`
 *     is rewritten at transform time.
 *  2. Vitest node env (this package's tests). `import.meta.glob` is undefined;
 *     fall back to filesystem reads.
 */
function loadFixtureSources(): Array<[string, string]> {
  // Context 1: Vite with `import.meta.glob` available.
  // We feature-detect rather than gate on `import.meta.env` because vitest
  // also defines `import.meta.env` but does NOT rewrite globs in node env.
  const maybeGlob = (import.meta as unknown as {
    glob?: (
      pattern: string,
      opts: { eager: true; query: string; import: string },
    ) => Record<string, string>;
  }).glob;
  if (typeof maybeGlob === "function") {
    try {
      const modules = maybeGlob("../fixtures/libraries/*.excalidrawlib", {
        eager: true,
        query: "?raw",
        import: "default",
      });
      return Object.entries(modules);
    } catch {
      // fall through to fs fallback
    }
  }

  // Context 2: node/vitest. Resolve fixtures relative to this source file.
  // We use a synchronous require-shaped fallback so this function stays
  // sync (callers don't await getBuiltInLibraries()).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const url = require("node:url") as typeof import("node:url");
    const here = url.fileURLToPath(import.meta.url);
    const fixturesDir = path.resolve(path.dirname(here), "../fixtures/libraries");
    if (!fs.existsSync(fixturesDir)) return [];
    const out: Array<[string, string]> = [];
    for (const entry of fs.readdirSync(fixturesDir)) {
      if (!entry.endsWith(".excalidrawlib")) continue;
      const full = path.join(fixturesDir, entry);
      out.push([entry, fs.readFileSync(full, "utf8")]);
    }
    return out;
  } catch {
    return [];
  }
}
