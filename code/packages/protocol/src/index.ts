// SPDX-License-Identifier: MIT
// Public surface for @atlasdraw/protocol.

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

export type { CommentAnchor, CommentSchemaV1 } from "./comment-schema.js";
export {
  COMMENTS_ARRAY_KEY,
  COMMENT_SCHEMA_VERSION,
  normalizeAnchor,
} from "./comment-schema.js";
