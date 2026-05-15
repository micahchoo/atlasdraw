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
export { parseRoomFragment, generateRoomKey, buildRoomFragment } from "./room-key";
