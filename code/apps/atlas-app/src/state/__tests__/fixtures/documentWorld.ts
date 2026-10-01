// SPDX-License-Identifier: AGPL-3.0-only
//
// Test doubles for the document known-red tests. They stand in for the
// two things a test cannot construct — Excalidraw and MapLibre — and nothing
// else. Every Atlasdraw module under test runs for real against them.
//
// Owned by the *.known-red.test.ts files in this folder. Per
// .claude/rules/test-fixtures.md: do not change these to fix one test.

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawDocument, Manifest } from "@atlasdraw/data";

export interface FakeSceneElement {
  id: string;
  type: string;
  version?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  isDeleted?: boolean;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}

type ChangeListener = (
  elements: readonly FakeSceneElement[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
) => void;

export interface FakeExcalidraw {
  api: ExcalidrawImperativeAPI;
  /** Every element, deleted ones included — what onChange receives. */
  all(): readonly FakeSceneElement[];
  /** Replace the scene the way a user edit or an undo would. */
  setElements(elements: readonly FakeSceneElement[]): void;
}

/**
 * A stateful stand-in for Excalidraw's imperative API. `updateScene` replaces
 * the element list and fires every onChange listener synchronously, as
 * Excalidraw does after its commit. `getSceneElements` hides deleted elements,
 * as the real one does.
 */
export function makeFakeExcalidraw(
  initial: readonly FakeSceneElement[] = [],
): FakeExcalidraw {
  let elements: readonly FakeSceneElement[] = initial;
  const files: Record<string, unknown> = {};
  const listeners = new Set<ChangeListener>();
  const appState: Record<string, unknown> = {
    viewBackgroundColor: "transparent",
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 },
    selectedElementIds: {},
  };

  const emit = () => {
    for (const l of Array.from(listeners)) {
      l(elements, appState, files);
    }
  };

  const api = {
    getSceneElements: () => elements.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => appState,
    getFiles: () => files,
    addFiles: (list: ReadonlyArray<{ id: string }>) => {
      for (const f of list) {
        files[f.id] = f;
      }
    },
    updateScene: (opts: {
      elements?: readonly FakeSceneElement[];
      appState?: Record<string, unknown>;
    }) => {
      if (opts.elements) {
        elements = opts.elements;
      }
      if (opts.appState) {
        Object.assign(appState, opts.appState);
      }
      emit();
    },
    onChange: (cb: ChangeListener) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  } as unknown as ExcalidrawImperativeAPI;

  return {
    api,
    all: () => elements,
    setElements: (next) =>
      (api.updateScene as unknown as (o: { elements: unknown }) => void)({
        elements: next,
      }),
  };
}

/**
 * The camera half of a MapLibre map: enough for a saver to read the camera
 * and a loader to set it. Stateful, so a test reads the camera back rather
 * than asking whether a method was called.
 */
export class FakeCameraMap {
  center: { lng: number; lat: number };
  zoom: number;
  bearing: number;
  pitch: number;

  constructor(camera: {
    center: [number, number];
    zoom: number;
    bearing?: number;
    pitch?: number;
  }) {
    this.center = { lng: camera.center[0], lat: camera.center[1] };
    this.zoom = camera.zoom;
    this.bearing = camera.bearing ?? 0;
    this.pitch = camera.pitch ?? 0;
  }

  getCenter() {
    return {
      ...this.center,
      toArray: () => [this.center.lng, this.center.lat],
    };
  }
  getZoom() {
    return this.zoom;
  }
  getBearing() {
    return this.bearing;
  }
  getPitch() {
    return this.pitch;
  }
  jumpTo(opts: {
    center?: [number, number] | { lng: number; lat: number };
    zoom?: number;
    bearing?: number;
    pitch?: number;
  }) {
    if (opts.center) {
      this.center = Array.isArray(opts.center)
        ? { lng: opts.center[0], lat: opts.center[1] }
        : { lng: opts.center.lng, lat: opts.center.lat };
    }
    if (opts.zoom !== undefined) {
      this.zoom = opts.zoom;
    }
    if (opts.bearing !== undefined) {
      this.bearing = opts.bearing;
    }
    if (opts.pitch !== undefined) {
      this.pitch = opts.pitch;
    }
  }
  setCenter(c: [number, number]) {
    this.jumpTo({ center: c });
  }
  setZoom(z: number) {
    this.zoom = z;
  }
  setBearing(b: number) {
    this.bearing = b;
  }
  setPitch(p: number) {
    this.pitch = p;
  }
}

export const SAVED_ULID = "01HZ8KQR5Z3MV7BJ4N6XPYD9TF";

/**
 * The manifest a v1 build wrote: version 1, and one entry per drawn element
 * beside the data and raster layers. This is the format of every file saved
 * before the v1 → v2 migration, so loading it exercises that migration.
 */
export interface SavedManifestV1
  extends Omit<Manifest, "version" | "layers" | "world"> {
  version: 1;
  layers: Array<
    | Manifest["layers"][number]
    | {
        kind: "annotation";
        id: string;
        label: string;
        visible: boolean;
        renamedByUser?: boolean;
      }
  >;
}

export function savedManifest(
  overrides: Partial<SavedManifestV1> = {},
): SavedManifestV1 {
  return {
    id: SAVED_ULID,
    version: 1,
    title: "Field notes",
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    basemap: { type: "registry", id: "protomaps-dark" },
    camera: { center: [13.4, 52.5], zoom: 11, bearing: 30, pitch: 0 },
    layers: [
      { kind: "annotation", id: "rect-1", label: "Ward 3", visible: true },
    ],
    permissions: { publicView: false },
    ...overrides,
  };
}

/** A geo-anchored rectangle, the shape every saved annotation has. */
export function geoRect(id: string, x = 512, y = 300): FakeSceneElement {
  return {
    id,
    type: "rectangle",
    version: 3,
    versionNonce: 1,
    index: "a0",
    x,
    y,
    width: 100,
    height: 80,
    opacity: 100,
    isDeleted: false,
    customData: {
      schemaVersion: 1,
      projection: "mercator",
      scaleMode: "geographic",
      geo: { kind: "point", lng: 13.4, lat: 52.5, zRef: 11 },
    },
  };
}

/**
 * A document as a v1 build saved it. The writer does not validate, so these
 * are the bytes such a build wrote; the reader migrates them on load. The
 * cast is the one place a v1 manifest stands in for the current type.
 */
export function savedDocument(
  overrides: Partial<Omit<AtlasdrawDocument, "manifest">> & {
    manifest?: SavedManifestV1;
  } = {},
): AtlasdrawDocument {
  const { manifest = savedManifest(), ...rest } = overrides;
  return {
    manifest: manifest as unknown as Manifest,
    scene: [geoRect("rect-1")] as unknown as AtlasdrawDocument["scene"],
    layers: new Map(),
    styleRef: {},
    files: new Map(),
    ...rest,
  };
}
