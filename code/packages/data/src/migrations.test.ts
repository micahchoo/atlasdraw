// SPDX-License-Identifier: MIT
// Format migrations: a file saved by an older build opens in this one.

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { read } from "./atlasdraw.js";
import {
  CURRENT_MANIFEST_VERSION,
  migrate,
  MigrationError,
} from "./migrations.js";

const v1Manifest = (layers: unknown[]) => ({
  id: "01HZX4N6S2K8Q5ZTABCDEFGHJK",
  version: 1,
  title: "Field notes",
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z",
  basemap: { type: "registry", id: "protomaps-dark" },
  camera: { center: [13.4, 52.5], zoom: 11, bearing: 0, pitch: 0 },
  layers,
  permissions: { publicView: false },
});

const dataEntry = {
  kind: "data",
  id: "dl:wells",
  label: "Wells",
  visible: true,
  featureCount: 0,
  style: {},
  source: "data/layer-dl:wells.geojson",
};

describe("migrate v1 → v2: annotation entries move onto their elements", () => {
  it("writes a user label and a hidden flag into customData.atlas, and drops the entries", () => {
    const out = migrate({
      manifest: v1Manifest([
        {
          kind: "annotation",
          id: "a",
          label: "Ward 3",
          visible: false,
          renamedByUser: true,
        },
        dataEntry,
      ]),
      scene: [{ id: "a", type: "rectangle", customData: { geo: { k: 1 } } }],
    });

    expect(out.manifest.version).toBe(2);
    expect(out.manifest.layers).toEqual([dataEntry]);
    expect(out.scene[0]).toEqual({
      id: "a",
      type: "rectangle",
      customData: { geo: { k: 1 }, atlas: { label: "Ward 3", hidden: true } },
    });
  });

  it("does not store a generated label", () => {
    const out = migrate({
      manifest: v1Manifest([
        { kind: "annotation", id: "a", label: "Rectangle", visible: true },
      ]),
      scene: [{ id: "a", type: "rectangle" }],
    });

    expect(out.scene[0]).toEqual({
      id: "a",
      type: "rectangle",
      customData: { atlas: {} },
    });
  });

  it("gives back the opacity an old hide wrote as 0", () => {
    const out = migrate({
      manifest: v1Manifest([
        { kind: "annotation", id: "a", label: "a", visible: false },
      ]),
      scene: [
        {
          id: "a",
          type: "rectangle",
          opacity: 0,
          customData: { atlasOriginalOpacity: 60 },
        },
      ],
    });

    expect(out.scene[0]).toEqual({
      id: "a",
      type: "rectangle",
      opacity: 60,
      customData: { atlas: { hidden: true } },
    });
  });

  it("leaves an element with no entry as it was", () => {
    const el = { id: "b", type: "ellipse" };
    const out = migrate({ manifest: v1Manifest([]), scene: [el] });

    expect(out.scene[0]).toBe(el);
  });
});

describe("migrate: versions", () => {
  it("returns a current-version document unchanged", () => {
    const doc = {
      manifest: { ...v1Manifest([]), version: CURRENT_MANIFEST_VERSION },
      scene: [],
    };

    expect(migrate(doc)).toBe(doc);
  });

  it("refuses a document from a newer build rather than guess", () => {
    expect(() =>
      migrate({
        manifest: { ...v1Manifest([]), version: CURRENT_MANIFEST_VERSION + 1 },
        scene: [],
      }),
    ).toThrow(MigrationError);
  });

  it("refuses a manifest with no numeric version", () => {
    expect(() =>
      migrate({ manifest: { ...v1Manifest([]), version: "1" }, scene: [] }),
    ).toThrow(MigrationError);
  });
});

describe("read() runs the migrations", () => {
  async function v1Zip(): Promise<Blob> {
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify(
        v1Manifest([
          {
            kind: "annotation",
            id: "a",
            label: "Ward 3",
            visible: true,
            renamedByUser: true,
          },
        ]),
      ),
    );
    zip.file(
      "scene.excalidraw.json",
      JSON.stringify({
        type: "excalidraw",
        elements: [{ id: "a", type: "rectangle", version: 1 }],
      }),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    return new Blob([bytes as unknown as BlobPart]);
  }

  it("opens a file saved by a v1 build as a v2 document", async () => {
    const doc = await read(await v1Zip());

    expect(doc.manifest.version).toBe(2);
    expect(doc.manifest.layers).toEqual([]);
    expect(doc.scene[0].customData).toEqual({ atlas: { label: "Ward 3" } });
  });
});
