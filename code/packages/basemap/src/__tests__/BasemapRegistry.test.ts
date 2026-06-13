// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";

import { BASEMAPS, getBasemap } from "../BasemapRegistry";

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
    // @ts-expect-error — intentionally testing a non-member id at runtime
    expect(getBasemap("does-not-exist")).toBeUndefined();
  });

  it("requiresRemote matches expected per id", () => {
    expect(getBasemap("protomaps-light")?.requiresRemote).toBe(false);
    expect(getBasemap("protomaps-dark")?.requiresRemote).toBe(false);
    expect(getBasemap("openfreemap-bright")?.requiresRemote).toBe(true);
    expect(getBasemap("osm-standard")?.requiresRemote).toBe(true);
  });
});
