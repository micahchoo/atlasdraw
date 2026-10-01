// SPDX-License-Identifier: AGPL-3.0-only
//
// KNOWN-RED tests for the document model (W1, architecture audit 03).
//
// Each `it.fails` states the CORRECT behaviour and fails on today's code. The
// W3 document owner flips each one to `it` when the fix lands.
//
// Everything here runs through the production composition: the real
// usePersistenceWiring (load -> hydrate -> autosave/forceSave through
// selectDocument), the real PersistenceStore on fake-indexeddb, the real
// layer registry, useLayerRegistrySync and useExcalidrawChangeHandler. Only
// Excalidraw and MapLibre are stand-ins (fixtures/documentWorld.ts).
//
// If a fix moves a responsibility to a hook this file does not mount (for
// example, camera restore in a map hook), mount that hook in `mountEditor`
// rather than weakening the assertion.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import { CoordinateSync } from "@atlasdraw/basemap";

import type { CoordinateSyncOptions } from "@atlasdraw/basemap";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { usePersistenceWiring } from "../../hooks/usePersistenceWiring";
import { useLayerRegistrySync } from "../../hooks/useLayerRegistrySync";
import { useExcalidrawChangeHandler } from "../../hooks/useExcalidrawChangeHandler";
import { FakeMercatorMap } from "../../hooks/geoOpFuzz.harness";
import { useShareLink } from "../../hooks/useShareLink";
import { createPersistenceStore } from "../persistence";
import { selectDocument } from "../selectDocument";
import { loadShareDocument, tokenFromPath } from "../loadShareDocument";
import { usePersistenceStore } from "../usePersistenceStore";
import { useLayerRegistryStore } from "../layerRegistry";
import { useDataLayerFCStore } from "../useDataLayerFCStore";
import { useRasterImageStore } from "../useRasterImageStore";
import { useMapInstanceStore } from "../mapInstance";
import { useBasemapStore } from "../basemap";
import { useSceneBinding, useSceneStore } from "../scene";
import {
  annotationRows,
  renameAnnotation,
  setAnnotationVisible,
} from "../annotations";

import {
  FakeCameraMap,
  SAVED_ULID,
  geoRect,
  makeFakeExcalidraw,
  savedDocument,
  savedManifest,
} from "./fixtures/documentWorld";

import type { HttpStorageClient } from "../../services/createHttpStorageClient";

import type { FeatureCollection } from "geojson";

import type maplibregl from "maplibre-gl";

// usePersistenceWiring's own IDB name and slot (state/persistence.ts).
const DB_NAME = "atlasdraw-autosave";

const NOTIFY = { error: () => {} };

const pointFC = (n: number): FeatureCollection => ({
  type: "FeatureCollection",
  features: Array.from({ length: n }, (_, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [13 + i * 1e-3, 52.5] },
    properties: { n: i },
  })),
});

const STYLE = {
  fillColor: "#0aa",
  strokeColor: "#077",
  strokeWidth: 1,
  opacity: 0.5,
};

const dataEntry = (id: string, label: string) => ({
  kind: "data" as const,
  id,
  label,
  visible: true,
  featureCount: 3,
  style: STYLE,
  source: `data/layer-${id}.geojson`,
});

/** A saved document with one annotation and two data layers. */
function docWithDataLayers(): AtlasdrawDocument {
  return savedDocument({
    manifest: savedManifest({
      layers: [
        { kind: "annotation", id: "rect-1", label: "Ward 3", visible: true },
        dataEntry("dl:wells", "Wells"),
        dataEntry("dl:roads", "Roads"),
      ],
    }),
    layers: new Map([
      ["dl:wells", pointFC(3)],
      ["dl:roads", pointFC(3)],
    ]),
  });
}

/** Put a document in the autosave slot, as an earlier session would have. */
async function seedAutosave(doc: AtlasdrawDocument): Promise<void> {
  const seed = createPersistenceStore();
  await seed.save(doc);
  await seed.close();
}

/** The raw bytes currently in the autosave slot. */
async function autosaveBytes(): Promise<Uint8Array> {
  const db = await openDB(DB_NAME, 1);
  const stored = (await db.get("state", "current")) as { bytes: Uint8Array };
  db.close();
  return new Uint8Array(stored.bytes);
}

/** The document currently in the autosave slot, read by the real reader. */
async function autosaveDocument(): Promise<AtlasdrawDocument> {
  const reader = createPersistenceStore();
  const doc = await reader.load();
  await reader.close();
  if (!doc) {
    throw new Error("autosave slot is empty");
  }
  return doc;
}

/**
 * Mount the editor's document wiring the way MapEditor does: persistence,
 * the registry <-> scene bridge, and the onChange handler that marks dirty.
 */
function mountEditor(
  api: ExcalidrawImperativeAPI,
  map: maplibregl.Map | null = null,
) {
  return renderHook(() => {
    usePersistenceWiring(api, NOTIFY);
    useSceneBinding(api);
    useLayerRegistrySync(map, api);
    const onChange = useExcalidrawChangeHandler({
      excalidrawAPI: api,
      map,
      syncNow: undefined,
      expectedOrigin: undefined,
      announceMapEditor: () => {},
      setMapBg: () => {},
      spaceHeldRef: { current: false },
    });
    useEffect(
      () =>
        api.onChange(
          onChange as unknown as Parameters<
            ExcalidrawImperativeAPI["onChange"]
          >[0],
        ),
      [onChange],
    );
  });
}

/** Wait until the loaded document's annotation is on the canvas. */
async function waitForHydrate(api: ExcalidrawImperativeAPI): Promise<void> {
  await waitFor(() =>
    expect(api.getSceneElements().map((e) => e.id)).toContain("rect-1"),
  );
  // hydrate() clears the UI dirty flag in a microtask; let it run.
  await act(async () => {
    await Promise.resolve();
  });
}

/** Save now and treat the result as the clean baseline. */
async function saveAndSettle(): Promise<void> {
  await act(async () => {
    await usePersistenceStore.getState().forceSave();
  });
  usePersistenceStore.getState().clearDirty();
}

function isDirty(): boolean {
  const s = usePersistenceStore.getState();
  return s.isDirty || (s.persistenceStore?.isDirty() ?? false);
}

beforeEach(async () => {
  // An empty autosave slot for every case. Cleared rather than deleted: an
  // earlier case's store may still hold a connection open.
  const db = await openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains("state")) {
        d.createObjectStore("state");
      }
    },
  });
  await db.clear("state");
  db.close();
  const reg = useLayerRegistryStore.getState();
  for (const id of reg.entries.map((e) => e.id)) {
    reg.remove(id);
  }
  useDataLayerFCStore.getState().clear();
  useRasterImageStore.getState().clear();
  usePersistenceStore.setState({ isDirty: false, isDraining: false });
  useMapInstanceStore.setState({ map: null });
  useBasemapStore.setState({ activeBasemapId: "protomaps-light" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Finding 1 — identity
// ---------------------------------------------------------------------------

describe("document identity", () => {
  it("keeps the loaded manifest id and createdAt across two saves with no edits", async () => {
    await seedAutosave(savedDocument());
    const fx = makeFakeExcalidraw();
    mountEditor(fx.api);
    await waitForHydrate(fx.api);

    await act(async () => {
      await usePersistenceStore.getState().forceSave();
    });
    const first = await autosaveDocument();
    await act(async () => {
      await usePersistenceStore.getState().forceSave();
    });
    const second = await autosaveDocument();

    expect(first.manifest.id).toBe(SAVED_ULID);
    expect(second.manifest.id).toBe(SAVED_ULID);
    expect(first.manifest.createdAt).toBe("2026-05-06T00:00:00.000Z");
    expect(second.manifest.createdAt).toBe("2026-05-06T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Finding 2 — determinism
// ---------------------------------------------------------------------------

describe("save determinism", () => {
  it("writes byte-identical archives for two saves with no edits", async () => {
    await seedAutosave(savedDocument());
    const fx = makeFakeExcalidraw();
    mountEditor(fx.api);
    await waitForHydrate(fx.api);

    // Only the clock moves between the two saves. Faking Date alone keeps
    // fake-indexeddb's own timers real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T09:00:00.000Z"));
    await act(async () => {
      await usePersistenceStore.getState().forceSave();
    });
    const first = await autosaveBytes();

    vi.setSystemTime(new Date("2026-10-01T09:00:10.000Z"));
    await act(async () => {
      await usePersistenceStore.getState().forceSave();
    });
    const second = await autosaveBytes();

    expect(second.length).toBe(first.length);
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding 3 — camera and basemap
// ---------------------------------------------------------------------------

describe("camera and basemap persistence", () => {
  it("saves the live camera and the chosen basemap", async () => {
    const map = new FakeCameraMap({
      center: [-74.0, 40.7],
      zoom: 12.5,
      bearing: 15,
      pitch: 0,
    });
    useMapInstanceStore.setState({ map: map as unknown as maplibregl.Map });
    const fx = makeFakeExcalidraw([geoRect("rect-1")]);
    mountEditor(fx.api);
    act(() => {
      useBasemapStore.getState().setActiveBasemapId("protomaps-dark");
    });

    await act(async () => {
      await usePersistenceStore.getState().forceSave();
    });
    const saved = await autosaveDocument();

    expect(saved.manifest.basemap.id).toBe("protomaps-dark");
    expect(saved.manifest.camera.center[0]).toBeCloseTo(-74.0, 6);
    expect(saved.manifest.camera.center[1]).toBeCloseTo(40.7, 6);
    expect(saved.manifest.camera.zoom).toBeCloseTo(12.5, 6);
    expect(saved.manifest.camera.bearing).toBeCloseTo(15, 6);
  });

  it("restores the saved camera and basemap on reload", async () => {
    await seedAutosave(savedDocument()); // camera [13.4, 52.5] z11 b30, protomaps-dark
    const map = new FakeCameraMap({ center: [0, 0], zoom: 2 });
    useMapInstanceStore.setState({ map: map as unknown as maplibregl.Map });
    const fx = makeFakeExcalidraw();
    mountEditor(fx.api, map as unknown as maplibregl.Map);
    await waitForHydrate(fx.api);

    expect(useBasemapStore.getState().activeBasemapId).toBe("protomaps-dark");
    expect(map.getCenter().lng).toBeCloseTo(13.4, 6);
    expect(map.getCenter().lat).toBeCloseTo(52.5, 6);
    expect(map.getZoom()).toBeCloseTo(11, 6);
    expect(map.getBearing()).toBeCloseTo(30, 6);
  });
});

// ---------------------------------------------------------------------------
// Finding 7 — what marks the document dirty
// ---------------------------------------------------------------------------

describe("dirty tracking", () => {
  async function loadedAndClean() {
    await seedAutosave(docWithDataLayers());
    const fx = makeFakeExcalidraw();
    mountEditor(fx.api);
    await waitForHydrate(fx.api);
    await saveAndSettle();
    expect(isDirty()).toBe(false);
    return fx;
  }

  it("renaming a layer marks the document dirty", async () => {
    await loadedAndClean();
    act(() =>
      useLayerRegistryStore.getState().renameLayer("dl:wells", "Boreholes"),
    );
    expect(isDirty()).toBe(true);
  });

  it("restyling a layer marks the document dirty", async () => {
    await loadedAndClean();
    act(() =>
      useLayerRegistryStore
        .getState()
        .updateStyle("dl:wells", { fillColor: "#ff0000" }),
    );
    expect(isDirty()).toBe(true);
  });

  it("reordering layers marks the document dirty", async () => {
    await loadedAndClean();
    const before = useLayerRegistryStore
      .getState()
      .entries.filter((e) => e.kind === "data")
      .map((e) => e.id);
    act(() => useLayerRegistryStore.getState().reorder(before[0], 1));
    const after = useLayerRegistryStore
      .getState()
      .entries.filter((e) => e.kind === "data")
      .map((e) => e.id);
    expect(after).not.toEqual(before); // the reorder did happen
    expect(isDirty()).toBe(true);
  });

  it("importing a data layer marks the document dirty", async () => {
    await loadedAndClean();
    act(() =>
      useLayerRegistryStore.getState().registerDataLayer({
        id: "dl:schools",
        fc: pointFC(4),
        label: "Schools",
        style: STYLE,
      }),
    );
    expect(isDirty()).toBe(true);
  });

  it("a pure map pan does not mark the document dirty", async () => {
    const map = new FakeMercatorMap(11, { lng: 13.4, lat: 52.5 });
    const fx = makeFakeExcalidraw([geoRect("rect-1")]);
    const sync = new CoordinateSync({
      map: map as unknown as maplibregl.Map,
      excalidrawAPI:
        fx.api as unknown as CoordinateSyncOptions["excalidrawAPI"],
    });
    mountEditor(fx.api);
    // First projection establishes where the drawing sits on screen.
    act(() => sync.syncMapToScene());
    await saveAndSettle();
    expect(isDirty()).toBe(false);

    const xBefore = fx.api.getSceneElements()[0].x;
    act(() => {
      map.panByScreen(200, 0);
      sync.syncMapToScene();
    });
    expect(fx.api.getSceneElements()[0].x).not.toBe(xBefore); // it did pan

    expect(isDirty()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Findings 4 and 5 — the annotation rows in the layer panel
// ---------------------------------------------------------------------------

/**
 * Whether the canvas shows an element. A hidden annotation carries
 * customData.atlas.hidden, which the fork's renderer does not draw
 * (packages/element/src/atlasHidden.ts).
 */
function shownOnCanvas(el: {
  isDeleted?: boolean;
  opacity?: number;
  customData?: Record<string, unknown>;
}): boolean {
  const atlas = el.customData?.atlas as { hidden?: boolean } | undefined;
  return !el.isDeleted && (el.opacity ?? 100) > 0 && atlas?.hidden !== true;
}

/** The annotation rows the layer panel shows. */
function panelRows() {
  return annotationRows(useSceneStore.getState().elements);
}

describe("annotation rows after reload and undo", () => {
  it("deleting a reloaded shape removes its row and keeps it out of the next save", async () => {
    await seedAutosave(savedDocument());
    const fx = makeFakeExcalidraw();
    mountEditor(fx.api);
    await waitForHydrate(fx.api);
    expect(panelRows().map((r) => r.id)).toEqual(["rect-1"]);

    act(() =>
      fx.setElements(fx.all().map((el) => ({ ...el, isDeleted: true }))),
    );

    expect(panelRows().map((r) => r.id)).toEqual([]);
    await act(async () => {
      await usePersistenceStore.getState().forceSave();
    });
    const saved = await autosaveDocument();
    expect(saved.manifest.layers.map((l) => l.id)).toEqual([]);
  });

  it("undo of a delete restores the user's label and hidden state, and the canvas agrees with the panel", async () => {
    const fx = makeFakeExcalidraw();
    mountEditor(fx.api);
    act(() => fx.setElements([geoRect("rect-9")]));
    act(() => {
      renameAnnotation(fx.api, "rect-9", "Ward 3");
      setAnnotationVisible(fx.api, "rect-9", false);
    });
    const hidden = fx.all()[0];
    expect(shownOnCanvas(hidden)).toBe(false); // the hide reached the canvas

    // Delete, then undo: Excalidraw's history puts back the element exactly
    // as it was before the delete.
    act(() => fx.setElements([{ ...hidden, isDeleted: true }]));
    act(() => fx.setElements([{ ...hidden, isDeleted: false }]));

    const entry = panelRows().find((r) => r.id === "rect-9");
    expect(entry).toMatchObject({
      label: "Ward 3",
      renamedByUser: true,
      visible: false,
    });
    expect(shownOnCanvas(fx.api.getSceneElements()[0])).toBe(entry?.visible);
  });
});

// ---------------------------------------------------------------------------
// Finding 6 — hash share links
// ---------------------------------------------------------------------------

/** An in-memory storage server: what the share link hands over, it returns. */
function makeMemoryStorage(): HttpStorageClient {
  const maps = new Map<string, Uint8Array>();
  const tokens = new Map<string, string>();
  let n = 0;
  const client = {
    async createMap(blob: Blob | Uint8Array) {
      const id = `map-${++n}`;
      maps.set(
        id,
        blob instanceof Uint8Array
          ? blob
          : new Uint8Array(await new Response(blob).arrayBuffer()),
      );
      return { id };
    },
    async createShareToken(mapId: string) {
      const token = `tok${String(++n).padStart(18, "0")}`; // 21 chars
      tokens.set(token, mapId);
      return { token };
    },
    async getShareBlob(token: string) {
      const mapId = tokens.get(token);
      const bytes = mapId ? maps.get(mapId) : undefined;
      return bytes ? (bytes.slice().buffer as ArrayBuffer) : null;
    },
  };
  return client as unknown as HttpStorageClient;
}

describe("share links", () => {
  // KNOWN-RED (W3 document owner): useShareLink sizes the document with JSON.stringify, which writes its layers and files Maps as {}, so a large GeoJSON layer looks small, takes hash mode, and is silently dropped. Flip to it() when fixed.
  it.fails(
    "a share link carries the data layers and files, or does not use hash mode",
    async () => {
      const fx = makeFakeExcalidraw([
        geoRect("rect-1"),
        {
          ...geoRect("photo-1"),
          type: "image",
          fileId: "img-1",
          status: "saved",
        },
      ]);
      fx.api.addFiles([
        {
          id: "img-1",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
          created: 0,
        },
      ] as unknown as Parameters<ExcalidrawImperativeAPI["addFiles"]>[0]);
      // ~150 KB of GeoJSON: far over the 32 KiB hash threshold.
      useLayerRegistryStore.getState().registerDataLayer({
        id: "dl:wells",
        fc: pointFC(2000),
        label: "Wells",
        style: STYLE,
      });

      const client = makeMemoryStorage();
      const { result } = renderHook(() =>
        useShareLink({
          getDoc: () =>
            selectDocument(fx.api, useLayerRegistryStore.getState()),
          client,
        }),
      );
      let url: string | null = null;
      await act(async () => {
        url = await result.current.generate();
      });
      expect(url).not.toBeNull();

      // Open the link the way ShareView does.
      const link = new URL(url as unknown as string);
      const loaded = await loadShareDocument(
        link.hash,
        tokenFromPath(link.pathname, "/m/"),
        client,
      );
      expect(loaded.kind).toBe("ready");
      const doc = loaded.kind === "ready" ? loaded.doc : null;
      const wells =
        doc?.layers instanceof Map ? doc.layers.get("dl:wells") : undefined;
      expect(wells?.features.length).toBe(2000);
      const files = doc?.files instanceof Map ? doc.files : undefined;
      expect(files?.has("img-1")).toBe(true);
    },
  );
});
