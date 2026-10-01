// SPDX-License-Identifier: AGPL-3.0-only
//
// KNOWN-RED tests for the document model (W1, architecture audit 03).
//
// Each `it.fails` states the CORRECT behaviour and fails on today's code. The
// W3 document owner flips each one to `it` when the fix lands.
//
// Everything here runs through the production composition: the real
// usePersistenceWiring (load -> loadDocument -> autosave/forceSave through
// toFile), the real PersistenceStore on fake-indexeddb, the real
// layer registry, useMapOverlays and useExcalidrawChangeHandler. Only
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

import { CameraBridge } from "@atlasdraw/basemap";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { usePersistenceWiring } from "../../hooks/usePersistenceWiring";
import { useMapOverlays } from "../../hooks/useMapOverlays";
import { FakeMapLibre } from "../../lib/__tests__/fixtures/fakeMapLibre";
import { useExcalidrawChangeHandler } from "../../hooks/useExcalidrawChangeHandler";
import { FakeMercatorMap } from "../../hooks/__tests__/fakeMercatorMap";
import { useShareLink } from "../../hooks/useShareLink";
import { createPersistenceStore } from "../persistence";
import { createDocument, currentDocument, openDocument } from "../document";
import { toFile } from "../documentIO";
import { sceneOf } from "../scene";
import { loadShareDocument } from "../loadShareDocument";
import { parseRoute } from "../../routes";
import { usePersistenceStore } from "../usePersistenceStore";
import { useMapInstanceStore } from "../mapInstance";
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

// usePersistenceWiring's own IDB name (state/persistence.ts).
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

/**
 * The raw bytes of the autosaved document a reload opens. Each document has
 * its own slot, `doc:<id>`; `lastOpened` names the one saved last.
 */
async function autosaveBytes(): Promise<Uint8Array> {
  const db = await openDB(DB_NAME, 1);
  const id = (await db.get("state", "lastOpened")) as string;
  const stored = (await db.get("state", `doc:${id}`)) as { bytes: Uint8Array };
  db.close();
  return new Uint8Array(stored.bytes);
}

/**
 * A camera fake that also holds a style, because the editor's map overlays
 * write one. Camera calls go to FakeCameraMap, style calls to FakeMapLibre.
 */
function cameraMap(
  camera: ConstructorParameters<typeof FakeCameraMap>[0],
): FakeCameraMap {
  const cam = new FakeCameraMap(camera);
  const style = new FakeMapLibre() as unknown as Record<
    string | symbol,
    unknown
  >;
  return new Proxy(cam, {
    get(target, key) {
      if (key in target) {
        return Reflect.get(target, key);
      }
      const value = style[key];
      return typeof value === "function" ? value.bind(style) : value;
    },
  });
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
    useMapOverlays(map);
    const onChange = useExcalidrawChangeHandler({
      excalidrawAPI: api,
      announceMapEditor: () => {},
      setMapBg: () => {},
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
  // A new, empty open document for every case.
  openDocument(createDocument());
  usePersistenceStore.setState({ isDirty: false, isDraining: false });
  useMapInstanceStore.setState({ map: null });
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
    const map = cameraMap({
      center: [-74.0, 40.7],
      zoom: 12.5,
      bearing: 15,
      pitch: 0,
    });
    useMapInstanceStore.setState({ map: map as unknown as maplibregl.Map });
    const fx = makeFakeExcalidraw([geoRect("rect-1")]);
    mountEditor(fx.api);
    act(() => {
      currentDocument().dispatch({ type: "set-basemap", id: "protomaps-dark" });
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
    const map = cameraMap({ center: [0, 0], zoom: 2 });
    useMapInstanceStore.setState({ map: map as unknown as maplibregl.Map });
    const fx = makeFakeExcalidraw();
    mountEditor(fx.api, map as unknown as maplibregl.Map);
    await waitForHydrate(fx.api);

    expect(currentDocument().snapshot().basemap).toBe("protomaps-dark");
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
      currentDocument().dispatch({
        type: "rename-layer",
        id: "dl:wells",
        label: "Boreholes",
      }),
    );
    expect(isDirty()).toBe(true);
  });

  it("restyling a layer marks the document dirty", async () => {
    await loadedAndClean();
    act(() =>
      currentDocument().dispatch({
        type: "restyle",
        id: "dl:wells",
        patch: { fillColor: "#ff0000" },
      }),
    );
    expect(isDirty()).toBe(true);
  });

  it("reordering layers marks the document dirty", async () => {
    await loadedAndClean();
    const before = currentDocument()
      .snapshot()
      .overlays.filter((e) => e.kind === "data")
      .map((e) => e.id);
    act(() =>
      currentDocument().dispatch({ type: "reorder", id: before[0], order: 1 }),
    );
    const after = currentDocument()
      .snapshot()
      .overlays.filter((e) => e.kind === "data")
      .map((e) => e.id);
    expect(after).not.toEqual(before); // the reorder did happen
    expect(isDirty()).toBe(true);
  });

  it("importing a data layer marks the document dirty", async () => {
    await loadedAndClean();
    act(() =>
      currentDocument().dispatch({
        type: "add-data-layer",
        id: "dl:schools",
        fc: pointFC(4),
        label: "Schools",
        style: STYLE,
      }),
    );
    expect(isDirty()).toBe(true);
  });

  it("a pure map pan does not mark the document dirty", async () => {
    // A camera move reaches the drawing through the camera bridge, as in
    // MapEditor (useCameraBridge): the map's `move` writes the viewport.
    const map = new (class extends FakeMercatorMap {
      private readonly moves = new Set<() => void>();
      on(_: "move", fn: () => void) {
        this.moves.add(fn);
      }
      off(_: "move", fn: () => void) {
        this.moves.delete(fn);
      }
      jumpTo(o: { center: { lng: number; lat: number }; zoom: number }) {
        this.center = o.center;
        this.zoom = o.zoom;
        this.fire();
      }
      fire() {
        this.moves.forEach((fn) => fn());
      }
    })(11, { lng: 13.4, lat: 52.5 });
    const fx = makeFakeExcalidraw([geoRect("rect-1")]);
    const bridge = new CameraBridge({
      map,
      scene: { updateScene: (data) => fx.api.updateScene(data as never) },
      frame: () => currentDocument().snapshot().world,
      viewportSize: () => ({ width: map.containerW, height: map.containerH }),
    });
    mountEditor(fx.api);
    // First push establishes where the drawing sits on screen.
    act(() => bridge.attach());
    await saveAndSettle();
    expect(isDirty()).toBe(false);

    const scrollBefore = fx.api.getAppState().scrollX;
    act(() => {
      map.panByScreen(200, 0);
      map.fire();
    });
    expect(fx.api.getAppState().scrollX).not.toBe(scrollBefore); // it did pan

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
  return annotationRows(
    useSceneStore.getState().elements,
    currentDocument().snapshot().world,
  );
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
  const bytesOf = async (blob: Blob | Uint8Array) =>
    blob instanceof Uint8Array
      ? blob
      : new Uint8Array(await new Response(blob).arrayBuffer());
  const client = {
    async createMap(blob: Blob | Uint8Array) {
      const id = `map${String(++n).padStart(18, "0")}`; // 21 chars
      maps.set(id, await bytesOf(blob));
      return { map: { id }, writeKey: `key-${id}` };
    },
    async updateMap(id: string, _key: string, blob: Blob | Uint8Array) {
      maps.set(id, await bytesOf(blob));
      return { id };
    },
    async createShareToken(mapId: string) {
      const token = `tok${String(++n).padStart(18, "0")}`; // 21 chars
      tokens.set(token, mapId);
      return { token, expiresAt: null };
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
  it("a share link carries the data layers and files, or does not use hash mode", async () => {
    const fx = makeFakeExcalidraw([
      geoRect("rect-1"),
      {
        ...geoRect("photo-1"),
        type: "image",
        fileId: "img-1",
        status: "saved",
      },
    ]);
    // The open document saves this drawing.
    openDocument(createDocument({}, sceneOf(fx.api)));
    fx.api.addFiles([
      {
        id: "img-1",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        created: 0,
      },
    ] as unknown as Parameters<ExcalidrawImperativeAPI["addFiles"]>[0]);
    // ~150 KB of GeoJSON: far over the 32 KiB hash threshold.
    currentDocument().dispatch({
      type: "add-data-layer",
      id: "dl:wells",
      fc: pointFC(2000),
      label: "Wells",
      style: STYLE,
    });

    const client = makeMemoryStorage();
    const { result } = renderHook(() =>
      useShareLink({
        getDoc: () => toFile(currentDocument()),
        client,
      }),
    );
    let url: string | null = null;
    await act(async () => {
      url = (await result.current.generate())?.url ?? null;
    });
    expect(url).not.toBeNull();

    // Open the link the way the viewer does.
    const route = parseRoute(new URL(url as unknown as string));
    const loaded = await loadShareDocument(
      route.kind === "share" ? route.map : null,
      client,
    );
    expect(loaded.kind).toBe("ready");
    const doc = loaded.kind === "ready" ? loaded.doc : null;
    const wells =
      doc?.layers instanceof Map ? doc.layers.get("dl:wells") : undefined;
    expect(wells?.features.length).toBe(2000);
    const files = doc?.files instanceof Map ? doc.files : undefined;
    expect(files?.has("img-1")).toBe(true);
  });
});
