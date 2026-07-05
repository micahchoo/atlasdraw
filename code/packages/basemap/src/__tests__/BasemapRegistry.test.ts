// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";

import {
  BASEMAPS,
  getBasemap,
  listBasemaps,
  registerBasemap,
} from "../BasemapRegistry";

describe("BasemapRegistry", () => {
  it("exposes exactly 4 entries", () => {
    expect(BASEMAPS).toHaveLength(4);
  });

  it("has unique ids", () => {
    const ids = BASEMAPS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains the expected ids", () => {
    const ids = BASEMAPS.map((b) => b.id).sort();
    expect(ids).toEqual(
      [
        "openfreemap-bright",
        "osm-standard",
        "protomaps-dark",
        "protomaps-light",
      ].sort(),
    );
  });

  it("getBasemap returns the matching entry", () => {
    const light = getBasemap("protomaps-light");
    expect(light).toBeDefined();
    expect(light?.label).toBe("Light");
    expect(light?.styleFile).toBe("protomaps-light.json");
    expect(light?.requiresRemote).toBe(false);
  });

  it("getBasemap returns undefined for unknown id", () => {
    // `id` widened from a closed union to `string` (ISSUES.md Direction 4) —
    // no longer a type error to pass an id that isn't (yet) registered.
    expect(getBasemap("does-not-exist")).toBeUndefined();
  });

  it("requiresRemote matches expected per id", () => {
    expect(getBasemap("protomaps-light")?.requiresRemote).toBe(false);
    expect(getBasemap("protomaps-dark")?.requiresRemote).toBe(false);
    expect(getBasemap("openfreemap-bright")?.requiresRemote).toBe(true);
    expect(getBasemap("osm-standard")?.requiresRemote).toBe(true);
  });
});

// ISSUES.md Direction 4 — registerBasemap()/listBasemaps() are the new
// registration API; BASEMAPS/getBasemap above keep their exact prior
// behavior, seeded from the same 4 entries via registerBasemap() internally.
describe("BasemapRegistry — registerBasemap/listBasemaps", () => {
  it("listBasemaps() returns the same 4 seeded entries as BASEMAPS", () => {
    expect(listBasemaps()).toEqual(BASEMAPS);
  });

  it("registerBasemap() adds a 5th basemap reachable via getBasemap and listBasemaps", () => {
    registerBasemap({
      id: "test-only-basemap",
      label: "Test Only",
      styleFile: "test-only.json",
      requiresRemote: false,
    });

    expect(getBasemap("test-only-basemap")).toMatchObject({
      label: "Test Only",
    });
    expect(listBasemaps().map((b) => b.id)).toContain("test-only-basemap");
  });

  it("registerBasemap() throws when the id is already registered", () => {
    expect(() =>
      registerBasemap({
        id: "protomaps-light",
        label: "Duplicate",
        styleFile: "x.json",
        requiresRemote: false,
      }),
    ).toThrow(/already registered/);
  });
});
