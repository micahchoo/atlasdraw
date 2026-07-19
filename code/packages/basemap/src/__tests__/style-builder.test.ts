// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";

import { buildStyle } from "../style-builder";

import type { BasemapConfig } from "../BasemapRegistry";

const localConfig: BasemapConfig = {
  id: "protomaps-light",
  label: "Light",
  styleFile: "does-not-exist.json", // forces fallback placeholder path
  requiresRemote: false,
  attribution: "© Protomaps © OpenStreetMap",
};

const remoteConfig: BasemapConfig = {
  id: "openfreemap-bright",
  label: "Bright",
  styleFile: "does-not-exist-remote.json",
  requiresRemote: true,
  attribution: "© OpenFreeMap © OpenMapTiles © OpenStreetMap",
};

describe("buildStyle", () => {
  it("substitutes __PMTILES_PATH__ when pmtilesPath is provided", async () => {
    const style = await buildStyle(localConfig, {
      pmtilesPath: "https://example.test/atlas.pmtiles",
    });
    const serialized = JSON.stringify(style);
    expect(serialized).not.toContain("__PMTILES_PATH__");
    expect(serialized).toContain("https://example.test/atlas.pmtiles");
  });

  it("returns a valid style spec shape", async () => {
    const style = await buildStyle(localConfig, { pmtilesPath: "x.pmtiles" });
    expect(style).toMatchObject({
      version: 8,
      sources: expect.any(Object),
      layers: expect.any(Array),
    });
  });

  it("does NOT substitute when basemap requires remote tiles", async () => {
    const style = await buildStyle(remoteConfig, {
      pmtilesPath: "should-not-appear.pmtiles",
    });
    const serialized = JSON.stringify(style);
    expect(serialized).not.toContain("should-not-appear.pmtiles");
  });

  it("leaves the token in place when no pmtilesPath provided (stub fallback)", async () => {
    const style = await buildStyle(localConfig);
    const serialized = JSON.stringify(style);
    // Placeholder fallback retains the token; substitution is opt-in.
    expect(serialized).toContain("__PMTILES_PATH__");
  });
});
