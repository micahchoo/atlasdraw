// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import { LIMITS } from "@atlasdraw/protocol";

import { sizeRefusal } from "./importPipeline";

const MB = 1024 * 1024;

describe("sizeRefusal", () => {
  it("takes a data file up to the import cap, which a server save also takes", () => {
    expect(sizeRefusal({ name: "a.geojson", size: LIMITS.import })).toBeNull();
    expect(LIMITS.import).toBeLessThanOrEqual(LIMITS.upload);
  });

  it("refuses a data file over the import cap, and names the cap", () => {
    const why = sizeRefusal({ name: "a.geojson", size: LIMITS.import + 1 });
    expect(why).toContain(`${LIMITS.import / MB} MB`);
  });

  it("takes a larger GeoTIFF: it is resampled, so the layer stays small", () => {
    expect(
      sizeRefusal({ name: "scene.tif", size: LIMITS.import + MB }),
    ).toBeNull();
    expect(
      sizeRefusal({ name: "scene.tif", size: LIMITS.importRaster + 1 }),
    ).toContain(`${LIMITS.importRaster / MB} MB`);
  });
});
