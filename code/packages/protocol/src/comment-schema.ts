// SPDX-License-Identifier: MIT
// The comment schema: a "comments" Y.Array of Y.Maps in a document's Y.Doc.
// In a room it is the room doc (docs/architecture/adr/0014-collab-trust-model.md):
// the relay reads comments like
// everything else in the room. In a saved file it is `comments.json`.
//
//   Y.Array "comments"
//     └─ Y.Map:
//          id             string (opaque)
//          authorId       string (the author's identity id: state/identity.ts)
//          authorName     string
//          text           string (plaintext)
//          createdAt      number (ms since epoch, client clock)
//          anchor         Y.Map, one of:
//                           { kind: "map", lng, lat }
//                           { kind: "annotation", source: "element", elementId }
//                           { kind: "annotation", source: "raster", rasterId }
//          resolved       boolean
//          schemaVersion  number (2)

/** Top-level Y.Array key on the comments Y.Doc. */
export const COMMENTS_ARRAY_KEY = "comments" as const;

/** Schema version literal; bump on incompatible shape changes. */
export const COMMENT_SCHEMA_VERSION = 2 as const;

/**
 * Anchor kinds.
 *
 *   "map"        – pinned to geographic coordinates; rendered via
 *                  map.project([lng, lat]) → screen-space pixels.
 *   "annotation" – follows an element or raster; re-projects when the
 *                  target moves, pans, or zooms. source disambiguates
 *                  between Excalidraw elements and georeferenced rasters.
 *
 * kind "element" is a v1→v2 migration shim. {@link normalizeAnchor} rewrites
 * it to the canonical `{ kind: "annotation", source: "element" }` shape.
 * Consumers MUST call normalizeAnchor on every read path; writers MUST
 * write only canonical (non-"element") forms.
 */
export type CommentAnchor =
  | { kind: "map"; lng: number; lat: number }
  | { kind: "element"; elementId: string }
  | { kind: "annotation"; source: "element"; elementId: string }
  | { kind: "annotation"; source: "raster"; rasterId: string };

/**
 * Canonicalize an anchor read from Yjs (which may carry v1 "element" entries
 * or v2 "annotation" entries) into the v2 canonical form.
 *
 * Writers MUST NOT produce "element"-kind anchors; this exists only for read
 * backward-compatibility with documents written by clients running
 * schema version 1.
 */
export function normalizeAnchor(anchor: CommentAnchor): CommentAnchor {
  if (anchor.kind === "element") {
    return {
      kind: "annotation",
      source: "element",
      elementId: anchor.elementId,
    };
  }
  return anchor;
}

/**
 * Plain-object projection of one comment row, as consumed by the React UI.
 * The wire representation is a Y.Map<string, unknown> with the same keys —
 * helpers in `apps/atlas-app/src/state/comments.ts` convert between the two.
 */
export interface CommentSchemaV1 {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
  anchor: CommentAnchor;
  resolved: boolean;
  schemaVersion: typeof COMMENT_SCHEMA_VERSION;
}
