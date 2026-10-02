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
// Pure: the gate's node tests load it.

import { sceneUnitsPerPixel, toScene, type WorldFrame } from "@atlasdraw/geo";

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

/** True for an element the pin tool made. */
export function isPin(el: Pick<ExcalidrawElement, "type" | "customData">) {
  return el.type === "ellipse" && el.customData?.tool === "pin";
}

/**
 * The files an element needs: an image's file, a pin's photo. Each path
 * that keeps, saves or sends the drawing's files asks this, so a photo is
 * never dropped as unused.
 */
export function elementFileIds(el: ExcalidrawElement): string[] {
  if (el.isDeleted) {
    return [];
  }
  const ids: string[] = [];
  const fileId = (el as { fileId?: unknown }).fileId;
  if (typeof fileId === "string" && fileId !== "") {
    ids.push(fileId);
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
