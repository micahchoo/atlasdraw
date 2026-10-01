// SPDX-License-Identifier: AGPL-3.0-only
//
// Layer ids in the selection. The selection itself is session view state
// (session/view.ts#selection), shaped like Excalidraw's selectedElementIds.
//
// An annotation id is an Excalidraw element id. Data layer ids are "dl:…",
// raster ids "rl:…" and tile layer ids "tl:…": they have no element, so only
// the Layers panel selects them.

/**
 * True for a data-layer, raster or tile-layer id. Every other selectable id
 * is an Excalidraw element id, which is an annotation.
 */
export function isOverlayId(id: string): boolean {
  return id.startsWith("dl:") || id.startsWith("rl:") || id.startsWith("tl:");
}
