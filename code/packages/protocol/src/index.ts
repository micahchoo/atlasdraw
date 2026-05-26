// SPDX-License-Identifier: MIT
// Public surface for @atlasdraw/protocol.

export type {
  CollabEvent,
  SceneUpdateEvent,
  MapCameraUpdateEvent,
  CursorEvent,
  CommentEvent,
  RequestSnapshotEvent,
  SceneSnapshotEvent,
  EncryptedPayload,
  VersionedEncryptedPayload,
  MapCameraPayload,
  CursorPayload,
  RealtimeConfig,
} from "./realtime-events";

export type { AwarenessState } from "./realtime-events";
export type { RoomKey } from "./room-key";
export {
  parseRoomFragment,
  generateRoomKey,
  buildRoomFragment,
} from "./room-key";

// Phase 6 A2 — anchored-comment Yjs schema (separate Y.Doc from data layer).
export type { CommentAnchor, CommentSchemaV1 } from "./comment-schema";
export {
  COMMENTS_ARRAY_KEY,
  COMMENT_SCHEMA_VERSION,
  buildCommentsDocPath,
} from "./comment-schema";
