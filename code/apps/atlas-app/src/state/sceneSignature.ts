// SPDX-License-Identifier: AGPL-3.0-only
//
// A number that changes when the drawing changes, and only then.
//
// Excalidraw raises an element's `version` (and draws a new `versionNonce`)
// on every edit it records: a move, a restyle, a delete, an undo. A camera
// move does not. CoordinateSync writes the new screen x/y with a plain spread
// and keeps both fields, so a pan gives a new elements array with the same
// versions. Array identity therefore says "something ran"; this signature
// says "the drawing changed".
//
// Deleted elements count. A delete sets `isDeleted` and keeps the element, so
// the length alone cannot see it.

/** The element fields the signature reads. */
export interface VersionedElement {
  readonly version?: number;
  readonly versionNonce?: number;
  readonly isDeleted?: boolean;
}

/**
 * djb2 over the length and each element's version, nonce and deleted flag.
 * Order matters, so a z-order change (which rewrites fractional indices and
 * bumps versions anyway) also changes it. O(n), no allocation.
 */
export function sceneSignature(elements: readonly VersionedElement[]): number {
  let hash = 5381;
  const mix = (n: number): void => {
    hash = ((hash << 5) + hash + (n | 0)) | 0;
  };
  mix(elements.length);
  for (const el of elements) {
    mix(el.version ?? 0);
    mix(el.versionNonce ?? 0);
    mix(el.isDeleted ? 1 : 0);
  }
  return hash >>> 0;
}
