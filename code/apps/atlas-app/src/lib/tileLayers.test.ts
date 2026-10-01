// SPDX-License-Identifier: AGPL-3.0-only
//
// Tile layers: which URL templates the editor accepts, and the credit line
// that the status bar and the exports print.

import { describe, expect, it } from "vitest";

import { creditLine, validateTileTemplate } from "./tileLayers";

import type { OverlayEntry } from "../state/document";

describe("validateTileTemplate", () => {
  it("accepts an https template with {z}, {x} and {y}", () => {
    expect(
      validateTileTemplate("https://tiles.example.org/{z}/{x}/{y}.png"),
    ).toEqual({ ok: true, url: "https://tiles.example.org/{z}/{x}/{y}.png" });
  });

  it("trims the template", () => {
    expect(
      validateTileTemplate("  https://t.example.org/{z}/{y}/{x}.jpg \n"),
    ).toEqual({ ok: true, url: "https://t.example.org/{z}/{y}/{x}.jpg" });
  });

  it("accepts http only for this computer", () => {
    for (const host of ["localhost:8080", "127.0.0.1", "[::1]:3000"]) {
      expect(validateTileTemplate(`http://${host}/{z}/{x}/{y}.png`).ok).toBe(
        true,
      );
    }
    expect(
      validateTileTemplate("http://tiles.example.org/{z}/{x}/{y}.png"),
    ).toEqual({
      ok: false,
      reason:
        "Use https. Only a server on this computer (localhost) can use http.",
    });
  });

  it("refuses a template without all three of {z}, {x} and {y}", () => {
    expect(validateTileTemplate("https://t.example.org/{z}/{x}.png")).toEqual({
      ok: false,
      reason: "The URL must contain {z}, {x} and {y}.",
    });
  });

  it("refuses {s}, which MapLibre does not fill in", () => {
    expect(
      validateTileTemplate("https://{s}.tile.example.org/{z}/{x}/{y}.png"),
    ).toEqual({
      ok: false,
      reason: "Replace {s} with one server name, for example a.",
    });
  });

  it("refuses text that is not a web URL", () => {
    for (const bad of ["", "tiles/{z}/{x}/{y}", "ftp://h/{z}/{x}/{y}"]) {
      expect(validateTileTemplate(bad)).toEqual({
        ok: false,
        reason: "Type a web address that starts with https://.",
      });
    }
  });
});

describe("creditLine", () => {
  const tile = (
    id: string,
    attribution: string | undefined,
    visible = true,
    order = 0,
  ): OverlayEntry => ({
    kind: "tile",
    id,
    label: id,
    visible,
    order,
    opacity: 1,
    url: "https://t.example.org/{z}/{x}/{y}.png",
    ...(attribution !== undefined ? { attribution } : {}),
  });

  it("is the basemap's credit when there are no tile layers", () => {
    expect(creditLine("© OpenStreetMap", [])).toBe("© OpenStreetMap");
  });

  it("adds the credit of each visible tile layer, top first, once each", () => {
    expect(
      creditLine("© OpenStreetMap", [
        tile("tl:a", "© Aerial Co", true, 0),
        tile("tl:b", "© Old Maps", true, 1),
        tile("tl:c", "© Aerial Co", true, 2),
        tile("tl:d", "© Hidden", false, 3),
        tile("tl:e", undefined, true, 4),
        tile("tl:f", "  ", true, 5),
      ]),
    ).toBe("© OpenStreetMap · © Aerial Co · © Old Maps");
  });

  it("drops a credit the basemap already gives", () => {
    expect(
      creditLine("© OpenStreetMap", [tile("tl:a", "© OpenStreetMap")]),
    ).toBe("© OpenStreetMap");
  });

  it("works with no basemap credit", () => {
    expect(creditLine(undefined, [tile("tl:a", "© Aerial Co")])).toBe(
      "© Aerial Co",
    );
  });
});
