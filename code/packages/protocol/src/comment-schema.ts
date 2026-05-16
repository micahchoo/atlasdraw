// SPDX-License-Identifier: MIT
// Atlasdraw Phase 6 A2 — anchored-comment Yjs schema.
//
// Comments live in a Y.Doc separate from the scene/data-layer Y.Doc (different
// ACL granularity, different volume, different conflict semantics — see
// original Phase 6 Task 6 spec for rationale). One Y.Doc per room (or
// per workspace/room when a WorkspaceId is attached); routed by the relay's
// y-websocket handler at:
//
//   /yjs/comments/${roomId}                       (legacy / no workspace)
//   /yjs/comments/${workspaceId}/${roomId}        (workspace-scoped)
//
// ─── Document shape ────────────────────────────────────────────────────────
//
//   Y.Doc
//     └─ "comments" Y.Array<Y.Map>
//           └─ Comment Y.Map:
//                 id             → string (uuid v4; opaque)
//                 authorId       → string (socket.id at create time;
//                                  see TRUST POSTURE below — rotates on
//                                  reconnect, so "delete own comment"
//                                  authorization is session-local only.)
//                 authorName     → string
//                 text           → string (plaintext; clients may render
//                                  markdown — schema treats it as opaque)
//                 createdAt      → number (ms since epoch, client clock; LWW)
//                 anchor         → Y.Map encoding one of:
//                                     { kind: "map", lng, lat }
//                                     { kind: "element", elementId }
//                 resolved       → boolean (LWW)
//                 schemaVersion  → number (1; bump on incompatible shape change)
//
// ─── TRUST POSTURE ─────────────────────────────────────────────────────────
//
// Per ADR-0010 Option C the relay holds plaintext comment Y.Docs in-process,
// same trust boundary as the data-layer Y.Doc. We do NOT encrypt comment
// payloads with the AES-GCM scene key, by design — Yjs CRDT merges happen
// server-side and require structural access. Self-host deployments treat the
// relay as trusted; SaaS deployments rely on workspace ACL at the relay
// boundary (Wave 3 A13).
//
// (The `CommentEvent` discriminant in CollabEvent uses VersionedEncryptedPayload
// for a Socket.IO-channel transport that v1 does NOT use — left in place for
// API stability but unused by Phase 6 comments. Comments flow over y-websocket
// only.)
//
// ─── References ─────────────────────────────────────────────────────────────
// - Plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A2/A3
// - ADR-0010 (server-trusted relay), ADR-0011 (no client telemetry beacon)
// - Q-P5-1 (collab wire protocol), Q-P5-2 (room key = write capability),
//   Q-P6-1 (Phase 6 scope cut)

/** Top-level Y.Array key on the comments Y.Doc. */
export const COMMENTS_ARRAY_KEY = "comments" as const;

/** Schema version literal; bump on incompatible shape changes. */
export const COMMENT_SCHEMA_VERSION = 1 as const;

/** Anchor kinds supported in v1. Extending requires a schemaVersion bump. */
export type CommentAnchor =
  | { kind: "map"; lng: number; lat: number }
  | { kind: "element"; elementId: string };

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

/**
 * Build the y-websocket URL path for a room's comments doc, honoring optional
 * workspace scoping (Phase 6 A9). The path is the docName — the relay's
 * upgrade handler accepts any /yjs/comments/... prefix and forwards
 * verbatim to setupWSConnection.
 *
 * Workspace scoping at this layer relies on URL-path isolation (separate
 * docName means separate Y.Doc map entry on the relay). Cross-workspace
 * reuse of a roomId yields a different docName and therefore a different
 * Yjs document — no leakage possible at the relay.
 */
export function buildCommentsDocPath(
  roomId: string,
  workspaceId: string | null,
): string {
  if (workspaceId && workspaceId.length > 0) {
    return `/yjs/comments/${workspaceId}/${roomId}`;
  }
  return `/yjs/comments/${roomId}`;
}
