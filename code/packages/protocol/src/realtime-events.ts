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
 * Canonical wire-protocol envelope for all Socket.IO traffic in Phase 5+.
 * Yjs data-layer ops travel on the separate `/yjs/:roomId` channel and are
 * not part of this union (per ADR-0010).
 */
export type CollabEvent =
  | SceneUpdateEvent
  | MapCameraUpdateEvent
  | CursorEvent
  | CommentEvent;

/** Realtime feature-flag config. `enabled = false` is the deployment default. */
export interface RealtimeConfig {
  enabled: boolean;
  /**
   * WebSocket URL the atlas-app connects to. When unset and `enabled` is true,
   * default to same-origin (resolved by client at runtime).
   */
  wsUrl?: string;
}
