// SPDX-License-Identifier: AGPL-3.0-only
//
// Annotations: the layer panel's view of the drawing.
//
// An annotation is a scene element. There is no second list of them. The
// panel rows are computed from the scene (`annotationRows`), and the panel's
// commands write the element (`renameAnnotation`, `setAnnotationVisible`,
// `deleteAnnotation`, `moveAnnotation`). What the panel adds to an element is
// in `customData.atlas`:
//
//   label   — set only when the user renamed the element. A label that is
//             not set is generated when the row is shown, never stored.
//   hidden  — true while the user hides the element. The renderer in the
//             fork does not draw it and hit-testing does not find it
//             (packages/element/src/atlasHidden.ts).
//
// Because both are element content, Excalidraw's undo and redo carry them,
// and so does collaboration. Every command raises the element's version and
// records an undo step.

import {
  CaptureUpdateAction,
  newElementWith,
  syncMovedIndices,
} from "@atlasdraw/element";
import { isGeoCustomData, type GeoCustomData } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";

/** What the panel stores on an element, under `customData.atlas`. */
export interface AtlasElementData {
  label?: string;
  hidden?: boolean;
}

/** The element fields the selector reads. */
export interface AnnotationSource {
  readonly id: string;
  readonly type?: string;
  readonly isDeleted?: boolean;
  readonly containerId?: string | null;
  readonly customData?: Record<string, unknown>;
}

/** One annotation row in the layer panel. */
export interface AnnotationRow {
  readonly kind: "annotation";
  readonly id: string;
  readonly label: string;
  /** The label is the user's, not a generated one. */
  readonly renamedByUser: boolean;
  readonly visible: boolean;
  /** Position among the annotation rows, bottom of the z-order first. */
  readonly order: number;
}

/** The part of the Excalidraw API the commands use. */
export type SceneWriter = Pick<
  ExcalidrawImperativeAPI,
  "getSceneElementsIncludingDeleted" | "updateScene"
>;

export function atlasData(el: AnnotationSource): AtlasElementData {
  const atlas = el.customData?.atlas;
  return atlas && typeof atlas === "object" ? (atlas as AtlasElementData) : {};
}

// ---------------------------------------------------------------------------
// Generated labels
// ---------------------------------------------------------------------------

/** The name of each Excalidraw element type in a generated label. */
const TOOL_NAMES: Record<string, string> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  freedraw: "Freehand",
  arrow: "Arrow",
  line: "Line",
  text: "Text",
  image: "Image",
  frame: "Frame",
  embeddable: "Embed",
  iframe: "Embed",
  magicframe: "Frame",
  selection: "Selection",
};

/** The approximate centre of a geo anchor. */
function geoCenter(customData: unknown): { lat: number; lng: number } | null {
  if (!isGeoCustomData(customData)) {
    return null;
  }
  const geo = (customData as GeoCustomData).geo;
  switch (geo.kind) {
    case "point":
      return { lat: geo.lat, lng: geo.lng };
    case "bbox":
      return {
        lat: (geo.north + geo.south) / 2,
        lng: (geo.east + geo.west) / 2,
      };
    case "polyline": {
      const first = geo.coordinates[0];
      return first ? { lng: first[0], lat: first[1] } : null;
    }
  }
}

/** "40.7°N, 74.0°W". */
function formatLatLng(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(1)}°${latDir}, ${Math.abs(lng).toFixed(
    1,
  )}°${lngDir}`;
}

/**
 * The label an element gets when the user has not named it.
 *
 * With a geo anchor: "Rectangle near 40.7°N, 74.0°W". Without: "Rectangle".
 * An unknown type without an anchor: the element id.
 */
export function generateLayerLabel(el: AnnotationSource): string {
  const typeName = el.type ? TOOL_NAMES[el.type] ?? el.type : null;
  const center = geoCenter(el.customData);
  if (typeName && center) {
    return `${typeName} near ${formatLatLng(center.lat, center.lng)}`;
  }
  if (typeName) {
    return typeName;
  }
  return el.id;
}

// ---------------------------------------------------------------------------
// The selector
// ---------------------------------------------------------------------------

/** Text bound to a container is part of the container's row. */
const isBoundText = (el: AnnotationSource): boolean => !!el.containerId;

/**
 * The panel's annotation rows: one per live element, in scene order (the
 * bottom of the z-order first). Pure: the same elements give equal rows.
 */
export function annotationRows(
  elements: readonly AnnotationSource[],
): AnnotationRow[] {
  const rows: AnnotationRow[] = [];
  for (const el of elements) {
    if (el.isDeleted || isBoundText(el)) {
      continue;
    }
    const atlas = atlasData(el);
    const userLabel = typeof atlas.label === "string" ? atlas.label : null;
    rows.push({
      kind: "annotation",
      id: el.id,
      label: userLabel ?? generateLayerLabel(el),
      renamedByUser: userLabel !== null,
      visible: atlas.hidden !== true,
      order: rows.length,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type Element = ExcalidrawElement;

function commit(scene: SceneWriter, elements: readonly Element[]): void {
  scene.updateScene({
    elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Write a new `customData.atlas` on one element. */
function writeAtlas(
  scene: SceneWriter,
  id: string,
  update: (atlas: AtlasElementData) => AtlasElementData,
): void {
  let changed = false;
  const next = scene.getSceneElementsIncludingDeleted().map((el) => {
    if (el.id !== id) {
      return el;
    }
    changed = true;
    return newElementWith(el, {
      customData: { ...el.customData, atlas: update(atlasData(el)) },
    });
  });
  if (changed) {
    commit(scene, next);
  }
}

/**
 * Give an element the user's name. There is no "back to generated": a name
 * someone typed is a decision, and a name that reverts on its own is worse
 * than no rename.
 */
export function renameAnnotation(
  scene: SceneWriter,
  id: string,
  label: string,
): void {
  writeAtlas(scene, id, (atlas) => ({ ...atlas, label }));
}

export function setAnnotationVisible(
  scene: SceneWriter,
  id: string,
  visible: boolean,
): void {
  writeAtlas(scene, id, ({ hidden: _hidden, ...rest }) =>
    visible ? rest : { ...rest, hidden: true },
  );
}

/** Delete the element, and the text bound to it, as an undoable step. */
export function deleteAnnotation(scene: SceneWriter, id: string): void {
  let changed = false;
  const next = scene.getSceneElementsIncludingDeleted().map((el) => {
    const bound = (el as { containerId?: string | null }).containerId === id;
    if ((el.id !== id && !bound) || el.isDeleted) {
      return el;
    }
    changed = true;
    return newElementWith(el, { isDeleted: true });
  });
  if (changed) {
    commit(scene, next);
  }
}

/**
 * Move an element to row position `toOrder` among the annotation rows,
 * which is its z-order among them. Out-of-range values clamp.
 */
export function moveAnnotation(
  scene: SceneWriter,
  id: string,
  toOrder: number,
): void {
  const all = scene.getSceneElementsIncludingDeleted();
  const rows = annotationRows(all);
  const from = rows.findIndex((r) => r.id === id);
  if (from === -1) {
    return;
  }
  const to = Math.max(0, Math.min(toOrder, rows.length - 1));
  if (to === from) {
    return;
  }
  const source = all.find((el) => el.id === id);
  if (!source) {
    return;
  }
  const moved = newElementWith(source, {}, true);
  const rest = all.filter((el) => el.id !== id);
  const targetId = rows[to].id;
  const targetAt = rest.findIndex((el) => el.id === targetId);
  // Down the stack: below the target. Up the stack: above it.
  const insertAt = to < from ? targetAt : targetAt + 1;
  const next = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
  commit(scene, syncMovedIndices(next, new Map([[id, moved]])));
}
