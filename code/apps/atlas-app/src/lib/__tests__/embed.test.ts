// SPDX-License-Identifier: AGPL-3.0-only
// The embed's URL options, its snippet and the box it fits on load.

import { describe, expect, it } from "vitest";

import { documentFrame, toScene } from "@atlasdraw/geo";

import {
  contentBox,
  embedSnippet,
  embedUrl,
  parseEmbedOptions,
  type EmbedChoices,
} from "../embed";

import type { OverlayEntry } from "../../state/document";

describe("parseEmbedOptions", () => {
  it("an embed fits the content, with no lock and no legend, by default", () => {
    expect(parseEmbedOptions("", "minimal")).toEqual({
      lock: false,
      legend: false,
      view: "fit",
    });
  });

  it("a share page opens at the saved view by default", () => {
    expect(parseEmbedOptions("", "share").view).toBe("saved");
  });

  it("reads lock=1, legend=1 and view=saved|fit", () => {
    expect(parseEmbedOptions("?lock=1&legend=1&view=saved", "minimal")).toEqual(
      { lock: true, legend: true, view: "saved" },
    );
    expect(parseEmbedOptions("?view=fit", "share").view).toBe("fit");
  });

  it("treats any other value as the default", () => {
    expect(
      parseEmbedOptions("?lock=yes&legend=true&view=north", "minimal"),
    ).toEqual({ lock: false, legend: false, view: "fit" });
  });
});

const SHARE = "https://maps.example.org/m#v2:abc";
const EMBED = "https://maps.example.org/embed#v2:abc";
const DEFAULTS: EmbedChoices = { legend: false, view: "fit", height: null };

describe("embedUrl", () => {
  it("is the share link on /embed, with no parameters for the defaults", () => {
    expect(embedUrl(SHARE, DEFAULTS, "/")).toBe(EMBED);
  });

  it("puts the parameters before the hash, where the server and the page read them", () => {
    expect(
      embedUrl(SHARE, { ...DEFAULTS, legend: true, view: "saved" }, "/"),
    ).toBe("https://maps.example.org/embed?legend=1&view=saved#v2:abc");
  });

  it("works for a token link too", () => {
    expect(
      embedUrl(
        "https://maps.example.org/m/abcdefghij1234567890K",
        { ...DEFAULTS, legend: true },
        "/",
      ),
    ).toBe("https://maps.example.org/embed/abcdefghij1234567890K?legend=1");
  });
});

describe("embedSnippet", () => {
  /** The iframe's style attribute, as declarations. */
  function style(snippet: string): Record<string, string> {
    const css = /style="([^"]*)"/.exec(snippet)?.[1] ?? "";
    return Object.fromEntries(
      css
        .split(";")
        .filter(Boolean)
        .map((d) => d.split(":").map((s) => s.trim()) as [string, string]),
    );
  }

  it("is full width with a 16:10 box, not a fixed 800 x 500", () => {
    const snippet = embedSnippet(SHARE, DEFAULTS, "/");
    expect(snippet).toContain(`src="${EMBED}"`);
    expect(snippet).not.toMatch(/width="800"|height="500"/);
    expect(style(snippet)).toMatchObject({
      width: "100%",
      "aspect-ratio": "16 / 10",
    });
    expect(snippet).toContain('title="Atlasdraw map"');
    expect(snippet).toContain('loading="lazy"');
    expect(snippet).toContain("allowfullscreen");
  });

  it("takes a fixed height in place of the aspect ratio when one is given", () => {
    const s = style(embedSnippet(SHARE, { ...DEFAULTS, height: 420 }, "/"));
    expect(s).toMatchObject({ width: "100%", height: "420px" });
    expect(s["aspect-ratio"]).toBeUndefined();
  });

  it("escapes the URL for the attribute", () => {
    const snippet = embedSnippet(
      SHARE,
      { ...DEFAULTS, legend: true, view: "saved" },
      "/",
    );
    expect(snippet).toContain("?legend=1&amp;view=saved#v2:abc");
  });
});

describe("contentBox", () => {
  const world = documentFrame(10, 50);
  const rect = (lng0: number, lat0: number, lng1: number, lat1: number) => {
    const a = toScene(world, lng0, lat0);
    const b = toScene(world, lng1, lat1);
    return {
      type: "rectangle",
      x: a.x,
      y: a.y,
      width: b.x - a.x,
      height: b.y - a.y,
      angle: 0,
    };
  };
  const data = (id: string, visible = true): OverlayEntry =>
    ({
      kind: "data",
      id,
      label: id,
      visible,
      order: 0,
      featureCount: 1,
      geometryKind: "circle",
      style: {},
    } as OverlayEntry);

  it("is null for an empty map: the embed keeps the saved view", () => {
    expect(
      contentBox({ world, overlays: [], featureCollections: {} }, []),
    ).toBeNull();
  });

  it("joins the drawing, the visible data layers and the visible rasters", () => {
    const box = contentBox(
      {
        world,
        overlays: [
          data("dl:a"),
          data("dl:hidden", false),
          {
            kind: "raster",
            id: "rl:a",
            label: "sheet",
            visible: true,
            order: 0,
            opacity: 1,
            imageKey: "a.png",
            corners: [
              [9, 51],
              [9.5, 51],
              [9.5, 50.5],
              [9, 50.5],
            ],
          },
        ],
        featureCollections: {
          "dl:a": {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [12, 48] },
              },
            ],
          },
          "dl:hidden": {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [40, 10] },
              },
            ],
          },
        },
      },
      [rect(10, 50, 11, 49)],
    );
    expect(box).not.toBeNull();
    expect(box!.west).toBeCloseTo(9, 6);
    expect(box!.north).toBeCloseTo(51, 6);
    expect(box!.east).toBeCloseTo(12, 6);
    expect(box!.south).toBeCloseTo(48, 6);
  });
});
