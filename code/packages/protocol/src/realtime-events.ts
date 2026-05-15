// SPDX-License-Identifier: MIT
// Atlasdraw realtime wire protocol — CollabEvent discriminated union.
//
// Phase 5 Task 1 (atlasdraw plan 2026-05-03 § Task 1). E-01 closed Option C
// 2026-05-11 (server-trusted relay; see ADR-0010). Encrypted variants here
// are AES-GCM with iv (12 bytes base64) + ciphertext (base64). Plaintext
// variants travel unencrypted by design (see ADR-0010 §"What the relay can see").

/** AES-GCM encrypted payload — emitted via @atlasdraw/protocol from Socket.IO clients. */
export interface EncryptedPayload {
  /** Base64-encoded 12-byte initialization vector. */
  iv: string;
  /** Base64-encoded ciphertext (AES-GCM tag appended per Web Crypto convention). */
  ciphertext: string;
}

/** Versioned AES-GCM payload — used for COMMENT to support LWW conflict resolution. */
export interface VersionedEncryptedPayload extends EncryptedPayload {
  /** Monotonic version counter; LWW reconciliation breaks ties on this. */
  version: number;
}

/** Plaintext camera update — relayed at ~30Hz, LWW by `timestamp`. */
export interface MapCameraPayload {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
}

/**
 * Plaintext cursor presence — relayed for peer-overlay rendering.
 * Coordinates are in Excalidraw scene space (not screen pixels).
 */
export interface CursorPayload {
  x: number;
  y: number;
  color: string;
  username: string;
}

interface BaseEvent {
  /** Room identifier — opaque to relay; clients derive from URL fragment. */
  roomId: string;
  /** Stable per-session sender id. Relay does not authenticate; clients verify origin. */
  senderId: string;
  /** Client-side wall-clock at emit; relay does not rewrite. */
  timestamp: number;
}

export interface SceneUpdateEvent extends BaseEvent {
  type: "SCENE_UPDATE";
  data: EncryptedPayload;
}

export interface MapCameraUpdateEvent extends BaseEvent {
  type: "MAP_CAMERA_UPDATE";
  data: MapCameraPayload;
}

export interface CursorEvent extends BaseEvent {
  type: "CURSOR";
  data: CursorPayload;
}

export interface CommentEvent extends BaseEvent {
  type: "COMMENT";
  data: VersionedEncryptedPayload;
}

/**
 * Joiner-pull request for the current scene state, emitted once after
 * `JOIN_ROOM` is acknowledged. Cites Q-P5-1: the relay deterministically
 * elects a single existing room member (lowest `socket.id` lexicographically)
 * and forwards this request to that one peer only — never broadcast. Avoids
 * the N-snapshot storm that would result from a sender-push design and gives
 * the joiner a deterministic retry path (re-emit on 2 s timeout; relay picks
 * the next eligible peer).
 *
 * Carries no addressing field — the relay reads the sender's own `socket.id`
 * server-side and includes it in the routed envelope so the elected peer
 * knows whom to address its `SceneSnapshotEvent` reply to.
 */
export interface RequestSnapshotEvent extends BaseEvent {
  type: "REQUEST_SNAPSHOT";
}

/**
 * Encrypted scene snapshot addressed to a specific joiner. Emitted by the
 * peer that the relay elected in response to a `RequestSnapshotEvent`. Cites
 * Q-P5-1: the relay routes this envelope to `targetId` only via
 * `io.to(targetId).emit(...)`, never broadcast. Preserves the ADR-0010
 * dumb-relay invariant — payload is AES-GCM with the room key, the relay
 * routes ciphertext without decrypting.
 *
 * `targetId` is opt-in per variant; it intentionally does NOT live on
 * `BaseEvent` to avoid polluting every event type with an addressing field
 * that is only meaningful for direct (non-room-broadcast) replies.
 */
export interface SceneSnapshotEvent extends BaseEvent {
  type: "SCENE_SNAPSHOT";
  /** Socket.IO id of the joiner this snapshot is addressed to. */
  targetId: string;
  data: EncryptedPayload;
}

/**
 * Canonical wire-protocol envelope for all Socket.IO traffic in Phase 5+.
 * Yjs data-layer ops travel on the separate `/yjs/:roomId` channel and are
 * not part of this union (per ADR-0010).
 */
export type CollabEvent =
  | SceneUpdateEvent
  | MapCameraUpdateEvent
  | CursorEvent
  | CommentEvent
  | RequestSnapshotEvent
  | SceneSnapshotEvent;

/** Realtime feature-flag config. `enabled = false` is the deployment default. */
export interface RealtimeConfig {
  enabled: boolean;
  /**
   * WebSocket URL the atlas-app connects to. When unset and `enabled` is true,
   * default to same-origin (resolved by client at runtime).
   */
  wsUrl?: string;
}

/**
 * y-protocols awareness state — broadcast per-client via y-websocket.
 * Encoded as JSON by y-protocols; consumed by CursorOverlay (Task 11)
 * and CollabState (Task 7) for presence rendering.
 */
export interface AwarenessState {
  user: { name: string; color: string };
  cursor: { x: number; y: number } | null;
  viewport: { lng: number; lat: number; zoom: number; bearing: number } | null;
  lastDrawAt: number | null;
}
