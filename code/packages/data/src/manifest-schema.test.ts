// SPDX-License-Identifier: MIT
// Schema tests.

import { describe, expect, it } from "vitest";

import { ManifestSchema } from "./manifest-schema";

const VALID_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const baseManifest = {
  id: VALID_ULID,
  version: 2 as const,
  title: "Test Map",
  createdAt: "2026-05-06T12:00:00.000Z",
  updatedAt: "2026-05-06T12:30:00.000Z",
  basemap: { type: "registry" as const, id: "protomaps-light" },
  camera: { center: [0, 0] as [number, number], zoom: 4, bearing: 0, pitch: 0 },
  world: { z0: 22, origin: { x: 0, y: 0 } },
  layers: [] as unknown[],
  permissions: { publicView: false },
};

describe("ManifestSchema", () => {
  it("parses a valid manifest", () => {
    const parsed = ManifestSchema.parse(baseManifest);
    expect(parsed.id).toBe(VALID_ULID);
    expect(parsed.version).toBe(2);
  });

  it("rejects missing id", () => {
    const { id: _id, ...m } = baseManifest;
    expect(ManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects non-ULID id", () => {
    expect(
      ManifestSchema.safeParse({ ...baseManifest, id: "not-a-ulid" }).success,
    ).toBe(false);
  });

  it("rejects ULID with forbidden Crockford characters (I/L/O/U)", () => {
    const bad = "01ARZ3NDEKTSV4RRFFQ69G5FAI"; // ends in I
    expect(ManifestSchema.safeParse({ ...baseManifest, id: bad }).success).toBe(
      false,
    );
  });

  it("rejects when updatedAt < createdAt", () => {
    expect(
      ManifestSchema.safeParse({
        ...baseManifest,
        createdAt: "2026-05-06T13:00:00.000Z",
        updatedAt: "2026-05-06T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts when updatedAt == createdAt", () => {
    const t = "2026-05-06T12:00:00.000Z";
    expect(
      ManifestSchema.safeParse({
        ...baseManifest,
        createdAt: t,
        updatedAt: t,
      }).success,
    ).toBe(true);
  });

  it("rejects any version but the current one (readers migrate first)", () => {
    expect(
      ManifestSchema.safeParse({ ...baseManifest, version: 1 }).success,
    ).toBe(false);
    expect(
      ManifestSchema.safeParse({ ...baseManifest, version: 3 }).success,
    ).toBe(false);
  });

  it("accepts empty layers array", () => {
    expect(ManifestSchema.safeParse(baseManifest).success).toBe(true);
  });

  it("accepts basemap.type 'registry'", () => {
    expect(
      ManifestSchema.safeParse({
        ...baseManifest,
        basemap: { type: "registry", id: "stadia" },
      }).success,
    ).toBe(true);
  });

  it("rejects basemap.type other than 'registry'", () => {
    expect(
      ManifestSchema.safeParse({
        ...baseManifest,
        basemap: { type: "tiled", url: "https://example.com" },
      }).success,
    ).toBe(false);
  });

  it("defaults permissions.publicView to false when permissions={}", () => {
    const parsed = ManifestSchema.parse({
      ...baseManifest,
      permissions: {},
    });
    expect(parsed.permissions.publicView).toBe(false);
  });

  it("rejects an annotation entry: a drawn element is not a manifest layer", () => {
    const m = {
      ...baseManifest,
      layers: [
        { kind: "annotation", id: "elem-1", label: "Pin 1", visible: true },
      ],
    };
    expect(ManifestSchema.safeParse(m).success).toBe(false);
  });

  it("accepts data layer entry with dl: prefix", () => {
    const m = {
      ...baseManifest,
      layers: [
        {
          kind: "data",
          id: "dl:abc123",
          label: "States",
          visible: true,
          featureCount: 50,
          style: {},
          source: "data/layer-dl:abc123.geojson",
        },
      ],
    };
    expect(ManifestSchema.safeParse(m).success).toBe(true);
  });

  it("rejects data layer id without dl: prefix", () => {
    const m = {
      ...baseManifest,
      layers: [
        {
          kind: "data",
          id: "abc123",
          label: "States",
          visible: true,
          featureCount: 50,
          style: {},
          source: "x",
        },
      ],
    };
    expect(ManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects negative featureCount", () => {
    const m = {
      ...baseManifest,
      layers: [
        {
          kind: "data",
          id: "dl:x",
          label: "X",
          visible: true,
          featureCount: -1,
          style: {},
          source: "x",
        },
      ],
    };
    expect(ManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects empty title", () => {
    expect(
      ManifestSchema.safeParse({ ...baseManifest, title: "" }).success,
    ).toBe(false);
  });

  describe("tileLayers (optional)", () => {
    const tile = {
      kind: "tile" as const,
      id: "tl:aerial",
      label: "Aerial",
      visible: true,
      opacity: 0.8,
      url: "https://tiles.example.org/{z}/{x}/{y}.png",
      attribution: "© Example",
    };

    it("is absent from a manifest that has none, and stays absent", () => {
      const parsed = ManifestSchema.parse(baseManifest);
      expect("tileLayers" in parsed).toBe(false);
    });

    it("parses tile layers, in order, with or without attribution", () => {
      const { attribution: _a, ...bare } = tile;
      const parsed = ManifestSchema.parse({
        ...baseManifest,
        tileLayers: [tile, { ...bare, id: "tl:topo" }],
      });
      expect(parsed.tileLayers).toEqual([tile, { ...bare, id: "tl:topo" }]);
    });

    it("rejects an id without the tl: prefix", () => {
      expect(
        ManifestSchema.safeParse({
          ...baseManifest,
          tileLayers: [{ ...tile, id: "dl:aerial" }],
        }).success,
      ).toBe(false);
    });

    it("rejects an opacity outside 0..1 and an empty url", () => {
      expect(
        ManifestSchema.safeParse({
          ...baseManifest,
          tileLayers: [{ ...tile, opacity: 2 }],
        }).success,
      ).toBe(false);
      expect(
        ManifestSchema.safeParse({
          ...baseManifest,
          tileLayers: [{ ...tile, url: "" }],
        }).success,
      ).toBe(false);
    });
  });
});
