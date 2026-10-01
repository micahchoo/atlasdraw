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
} from "./realtime-events.js";

export type { AwarenessState } from "./realtime-events.js";
export type { RoomLink } from "./room-link.js";
export {
  newRoomLink,
  parseRoomLink,
  readRoomTokenMessage,
  roomFragment,
  roomToken,
  roomTokenMessage,
  withRoomToken,
} from "./room-link.js";
export type { RoomKey } from "./room-key.js";
export {
  parseRoomFragment,
  generateRoomKey,
  buildRoomFragment,
} from "./room-key.js";

// Phase 6 A2 — anchored-comment Yjs schema (separate Y.Doc from data layer).
export type { CommentAnchor, CommentSchemaV1 } from "./comment-schema.js";
export {
  COMMENTS_ARRAY_KEY,
  COMMENT_SCHEMA_VERSION,
  buildCommentsDocPath,
  normalizeAnchor,
} from "./comment-schema.js";
