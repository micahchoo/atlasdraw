import { describe, it, expect } from "vitest";

import { excalidrawToGeo } from "./excalidrawToGeo.js";

import type { ExcalidrawElementLike } from "./CoordinateSync.js";
import type { GeoCustomData } from "./types.js";

describe("excalidrawToGeo", () => {
  it("returns the GeoAnchor when element has valid customData.geo", () => {
    const customData: GeoCustomData = {
      geo: { kind: "point", lng: -73.99, lat: 40.74, zRef: 12 },
      scaleMode: "screen",
      projection: "mercator",
      schemaVersion: 1,
    };
    const el: ExcalidrawElementLike = {
      id: "p1",
      x: 0,
      y: 0,
      customData,
    };
    const anchor = excalidrawToGeo(el);
    expect(anchor).not.toBeNull();
    expect(anchor?.kind).toBe("point");
    if (anchor && anchor.kind === "point") {
      expect(anchor.lng).toBe(-73.99);
      expect(anchor.lat).toBe(40.74);
    }
  });

  it("returns null for elements without geo customData", () => {
    const el: ExcalidrawElementLike = { id: "x1", x: 10, y: 10 };
    expect(excalidrawToGeo(el)).toBeNull();
  });

  it("returns null when customData is present but not GeoCustomData-shaped", () => {
    const el: ExcalidrawElementLike = {
      id: "x2",
      x: 0,
      y: 0,
      customData: { something: "else" },
    };
    expect(excalidrawToGeo(el)).toBeNull();
  });
});
