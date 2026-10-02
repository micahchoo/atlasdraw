// SPDX-License-Identifier: MPL-2.0
//
// A basemap that is not `requiresRemote` must draw with no third-party
// request: its tiles, its label glyphs and its sprite all come from the
// app's own origin. A URL that names a host breaks "offline means offline"
// with no error, because MapLibre only logs a failed glyph range.
import { describe, expect, it } from "vitest";

import { BASEMAPS } from "../BasemapRegistry";
import { resolveStyle } from "../resolver";

/** Every URL a MapLibre style fetches: tiles, TileJSON, glyphs, sprite. */
function urlsOf(style: unknown): string[] {
  const s = style as {
    sources?: Record<string, { tiles?: string[]; url?: string }>;
    glyphs?: string;
    sprite?: string | Array<{ url: string }>;
  };
  const urls: string[] = [];
  for (const source of Object.values(s.sources ?? {})) {
    urls.push(...(source.tiles ?? []));
    if (source.url) {
      urls.push(source.url);
    }
  }
  if (s.glyphs) {
    urls.push(s.glyphs);
  }
  if (typeof s.sprite === "string") {
    urls.push(s.sprite);
  } else if (Array.isArray(s.sprite)) {
    urls.push(...s.sprite.map((x) => x.url));
  }
  return urls;
}

/** A path on the page's own origin, directly or through `pmtiles://`. */
function sameOrigin(url: string): boolean {
  const path = url.replace(/^pmtiles:\/\//, "");
  return path.startsWith("/") && !path.startsWith("//");
}

const OFFLINE = BASEMAPS.filter((b) => !b.requiresRemote);

describe("offline basemaps", () => {
  it("there is at least one", () => {
    expect(OFFLINE.length).toBeGreaterThan(0);
  });

  it.each(OFFLINE.map((b) => b.id))(
    "%s references only same-origin URLs, glyphs and sprite included",
    async (id) => {
      const style = await resolveStyle(id, {
        allowRemote: false,
        pmtilesPath: "/data/world-low-zoom.pmtiles",
        assetsPath: "/basemap",
      });
      const urls = urlsOf(style);
      expect(urls.filter((u) => !sameOrigin(u))).toEqual([]);
      expect(style.glyphs).toBe("/basemap/fonts/{fontstack}/{range}.pbf");
      expect(style.sprite).toMatch(/^\/basemap\/sprites\/v4\/(light|dark)$/);
    },
  );
});
