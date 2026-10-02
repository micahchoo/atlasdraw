// SPDX-License-Identifier: AGPL-3.0-only
// What a route downloads before it paints, read from the build's manifest.
//
// A route's boot payload is the page entry (index.html's script and styles)
// plus the route root's chunk, each with every chunk it imports STATICALLY.
// A dynamic import is a separate download that happens later, on demand, so
// it is not in the payload. scripts/check-boot-size.ts sums these files and
// holds each route to a budget; this module is the pure half, tested.

export interface ManifestChunk {
  file: string;
  name?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

/** `dist/.vite/manifest.json`, as `vite build --manifest` writes it. */
export type Manifest = Record<string, ManifestChunk>;

const PAGE_ENTRY = "index.html";

/**
 * The manifest key of the route root whose chunk is named `name`. The name,
 * not the key: Vite files a dynamic entry that another chunk also imports
 * under a shared-chunk key such as `_MapEditor-DNxfw9gU.js`.
 */
function rootKey(manifest: Manifest, name: string): string {
  const keys = Object.keys(manifest).filter(
    (k) => manifest[k].isDynamicEntry && manifest[k].name === name,
  );
  if (keys.length !== 1) {
    throw new Error(
      `The build has ${keys.length} route roots named ${name}; expected 1.`,
    );
  }
  return keys[0];
}

/**
 * The files (JS and CSS, relative to dist/) that the page entry and the
 * route root named `route` (the chunk name, such as "MapEditor") load before
 * the route can render. Each file is listed once, in the order the walk
 * meets it.
 */
export function routePayload(manifest: Manifest, route: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const add = (file: string): void => {
    if (!seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  };
  const walk = (key: string): void => {
    const chunk = manifest[key];
    if (!chunk) {
      throw new Error(`The build has no chunk for ${key}.`);
    }
    if (seen.has(chunk.file)) {
      return;
    }
    add(chunk.file);
    for (const css of chunk.css ?? []) {
      add(css);
    }
    for (const dep of chunk.imports ?? []) {
      walk(dep);
    }
  };
  walk(PAGE_ENTRY);
  walk(rootKey(manifest, route));
  return files;
}

export interface BudgetRow {
  route: string;
  bytes: number;
  budget: number | undefined;
  pass: boolean;
}

/**
 * Hold each measured route to its budget, in bytes. A route with no budget
 * fails: a new route must be given a number before it can ship unmeasured.
 */
export function checkBudgets(
  sizes: Record<string, number>,
  budgets: Record<string, number>,
): BudgetRow[] {
  return Object.entries(sizes).map(([route, bytes]) => {
    const budget = budgets[route];
    return {
      route,
      bytes,
      budget,
      pass: budget !== undefined && bytes <= budget,
    };
  });
}
