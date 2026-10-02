/**
 * Offline means offline: the default basemap draws its labels with every
 * request to another host refused.
 *
 * MapLibre places a label only when the glyphs of its text have loaded, so
 * a rendered symbol feature proves the glyphs came from this origin. When
 * the glyphs were on protomaps.github.io, this page drew roads and water
 * and no place name, and said so only in the console.
 */

import { test, expect } from "@playwright/test";

import { openEditor } from "./helpers/atlas";

interface LabelMap {
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  once(type: "idle", fn: () => void): void;
  getStyle(): { layers: Array<{ id: string; type: string }> };
  queryRenderedFeatures(o: { layers: string[] }): unknown[];
}

test("the default basemap draws labels with no other host reachable", async ({
  page,
}) => {
  const own = new URL(test.info().project.use.baseURL ?? "").origin;
  const refused: string[] = [];
  await page.route(
    (url) => url.origin !== own,
    (route) => {
      refused.push(route.request().url());
      return route.abort();
    },
  );
  const glyphs: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/basemap/fonts/")) {
      glyphs.push(r.status());
    }
  });

  await openEditor(page);

  // Europe at zoom 4: the bundled world archive has country and city names.
  const labels = await page.evaluate(async () => {
    const map = (window as unknown as { __atlasdraw__: { map: LabelMap } })
      .__atlasdraw__.map;
    await new Promise<void>((resolve) => {
      map.once("idle", resolve);
      map.jumpTo({ center: [10, 50], zoom: 4 });
    });
    const symbols = map
      .getStyle()
      .layers.filter((l) => l.type === "symbol")
      .map((l) => l.id);
    return map.queryRenderedFeatures({ layers: symbols }).length;
  });

  expect(labels).toBeGreaterThan(0);
  expect(glyphs.length).toBeGreaterThan(0);
  expect(glyphs.every((s) => s === 200 || s === 304)).toBe(true);
  expect(refused).toEqual([]);
});
