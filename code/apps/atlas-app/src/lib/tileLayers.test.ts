// SPDX-License-Identifier: AGPL-3.0-only
//
// Tile layers: which URL templates the editor accepts. The credit line is
// tested in lib/__tests__/mapView.test.ts.

import { describe, expect, it } from "vitest";

import { validateTileTemplate } from "./tileLayers";

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
