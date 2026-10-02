// SPDX-License-Identifier: AGPL-3.0-only
//
// Pin details: a title, a description, a link and a photo on a pin.
//
// A pin is an ellipse the pin tool made (`customData.tool = "pin"`,
// tools/seedToElement.ts). Its details live on the element, in
// `customData.pin`, so they travel with the drawing on every path (file,
// share link, room) and an edit is one step of the drawing's own history.
// The photo is a file of the drawing, named by its id, like an image
// element's `fileId`.
//
// Every reader goes through `readPinDetails`, and the gate repairs a pin
// from outside with it (roomValidation.ts#checkElement). Text is shown as
// text nodes only. A link is kept only when it is http or https
// (`safeLink`), and the page shows it with rel="noopener noreferrer".
//
// The editor writes details with `setPinDetails`: one step of the drawing's
// own history, so Ctrl+Z takes it back like a move or a recolor.
//
// No DOM: the gate's node tests load it.

import { CaptureUpdateAction, newElementWith } from "@atlasdraw/element";
import { sceneUnitsPerPixel, toScene, type WorldFrame } from "@atlasdraw/geo";

import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@atlasdraw/excalidraw/types";

import type { ExcalidrawElement } from "@atlasdraw/element/types";

/** Characters each field may hold. A longer field is dropped, not cut. */
export const PIN_LIMITS = {
  title: 200,
  description: 5_000,
  link: 2_048,
  /** A file id, as the room's id cap. */
  photo: 256,
} as const;

export interface PinDetails {
  title?: string;
  description?: string;
  /** An http or https address. */
  link?: string;
  /** The id of a file of the drawing. */
  photo?: string;
}

/** How near a click must come to a pin, in screen pixels past its edge. */
const PIN_REACH_PX = 6;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The address when it is http or https and within the cap; else null. */
export function safeLink(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > PIN_LIMITS.link) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:"
    ? url.href
    : null;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() !== "" && value.length <= max
    ? value
    : undefined;
}

/** The valid details of an element's customData; a wrong field is left out. */
export function readPinDetails(customData: unknown): PinDetails {
  const pin = isRecord(customData) ? customData.pin : undefined;
  if (!isRecord(pin)) {
    return {};
  }
  const link =
    typeof pin.link === "string" && safeLink(pin.link) === pin.link
      ? pin.link
      : undefined;
  const details: PinDetails = {
    title: text(pin.title, PIN_LIMITS.title),
    description: text(pin.description, PIN_LIMITS.description),
    link,
    photo: text(pin.photo, PIN_LIMITS.photo),
  };
  return Object.fromEntries(
    Object.entries(details).filter(([, v]) => v !== undefined),
  ) as PinDetails;
}

/**
 * customData with `pin` set to the valid fields of `details`; without `pin`
 * when none is set. The other keys stay.
 */
export function withPinDetails(
  customData: Record<string, unknown> | undefined,
  details: PinDetails,
): Record<string, unknown> {
  const { pin: _old, ...rest } = customData ?? {};
  const clean = readPinDetails({ pin: details });
  return Object.keys(clean).length > 0 ? { ...rest, pin: clean } : rest;
}

/**
 * The fields of an element these functions read. A saved scene element
 * (`@atlasdraw/data` SceneElement) has them as `unknown`.
 */
interface ElementLike {
  readonly type: string;
  readonly isDeleted?: unknown;
  readonly customData?: unknown;
  readonly fileId?: unknown;
}

/** True for an element the pin tool made. */
export function isPin(el: ElementLike): boolean {
  return (
    el.type === "ellipse" &&
    isRecord(el.customData) &&
    el.customData.tool === "pin"
  );
}

/**
 * The files an element needs: an image's file, a pin's photo. Each path
 * that keeps, saves or sends the drawing's files asks this, so a photo is
 * never dropped as unused.
 */
export function elementFileIds(el: ElementLike): string[] {
  if (el.isDeleted === true) {
    return [];
  }
  const ids: string[] = [];
  if (typeof el.fileId === "string" && el.fileId !== "") {
    ids.push(el.fileId);
  }
  if (isPin(el)) {
    const photo = readPinDetails(el.customData).photo;
    if (photo) {
      ids.push(photo);
    }
  }
  return ids;
}

/**
 * The topmost pin at a place on the map, or null. A pin is a circle; the
 * reach past its edge is a few screen pixels at the map's zoom.
 */
export function pinAt(
  elements: readonly ExcalidrawElement[],
  frame: WorldFrame,
  lngLat: { lng: number; lat: number },
  zoom: number,
): ExcalidrawElement | null {
  const p = toScene(frame, lngLat.lng, lngLat.lat);
  const reach = PIN_REACH_PX * sceneUnitsPerPixel(frame, zoom);
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || !isPin(el)) {
      continue;
    }
    const r = Math.max(el.width, el.height) / 2;
    const dx = p.x - (el.x + el.width / 2);
    const dy = p.y - (el.y + el.height / 2);
    if (Math.hypot(dx, dy) <= r + reach) {
      return el;
    }
  }
  return null;
}

/**
 * The data URL of a pin's photo, from the drawing's files; null when there
 * is none or the file is not an image. Never a URL of another host.
 */
export function photoUrlOf(
  details: PinDetails,
  files: Readonly<Record<string, { dataURL?: unknown } | undefined>>,
): string | null {
  const url = details.photo ? files[details.photo]?.dataURL : undefined;
  return typeof url === "string" && url.startsWith("data:image/") ? url : null;
}

/** The selected element when it is one pin; null otherwise. */
export function selectedPin(
  api: Pick<ExcalidrawImperativeAPI, "getAppState" | "getSceneElements">,
): ExcalidrawElement | null {
  const selected = api.getAppState().selectedElementIds;
  const ids = Object.keys(selected).filter((id) => selected[id]);
  if (ids.length !== 1) {
    return null;
  }
  const el = api.getSceneElements().find((e) => e.id === ids[0]);
  return el && isPin(el) ? el : null;
}

/** A photo the user picked, before it is a file of the drawing. */
export interface PinPhoto {
  mimeType: string;
  dataURL: string;
}

/**
 * Write `details` onto the pin `pinId`, as one step of the drawing's
 * history. A new `photo` is added as a file of the drawing and named on the
 * pin. Nothing happens when `pinId` is no live pin.
 */
export function setPinDetails(
  api: Pick<
    ExcalidrawImperativeAPI,
    "getSceneElementsIncludingDeleted" | "updateScene" | "addFiles"
  >,
  pinId: string,
  details: PinDetails,
  photo?: PinPhoto,
): void {
  const all = api.getSceneElementsIncludingDeleted();
  const target = all.find((e) => e.id === pinId);
  if (!target || target.isDeleted || !isPin(target)) {
    return;
  }
  let next = details;
  if (photo) {
    const id = `pin-photo-${crypto.randomUUID()}`;
    api.addFiles([
      {
        id,
        mimeType: photo.mimeType,
        dataURL: photo.dataURL,
        created: Date.now(),
      } as unknown as BinaryFileData,
    ]);
    next = { ...details, photo: id };
  }
  api.updateScene({
    elements: all.map((e) =>
      e.id === pinId
        ? newElementWith(e, {
            customData: withPinDetails(e.customData, next),
          })
        : e,
    ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}
