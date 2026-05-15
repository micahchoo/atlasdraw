// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 Task 7 — CollabState lifecycle (client-side).
//
// The single gatekeeper that opens/closes both WebSocket connections (Socket.IO
// + y-websocket /yjs/:roomId), reads the room key from the URL fragment, and
// degrades gracefully when realtime is disabled (Q1).
//
// Flow position: Step 1 of 3 in client-collab (config → collab-state → UI).
// Upstream contract: receives RealtimeConfig from getAppConfig().realtime.
// Downstream contract: CollabState consumed by useCollab hook (Task 7 Step 2),
//   CursorOverlay (Task 11), PresenceList (Task 11), useYjsLayer (Task 9).
//
// OQ-5 resolution: per-client camera model. Remote MAP_CAMERA_UPDATE events
// are stored as peer viewport overlays only — local camera is never updated.

import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import { YjsLayer, CollabUndoManager } from "@atlasdraw/data";
import { getAppConfig } from "../config/app-config";
import type { ExcalidrawElement } from "@excalidraw/excalidraw";
import { encryptScene, decryptScene } from "../collab/scene-crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Cursor position in Excalidraw scene-space coordinates. */
export interface CursorState {
  x: number;
  y: number;
}

/** Viewport state for a remote peer's minimap/camera overlay. */
export interface PeerCamera {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
}

/**
 * Tracks a remote collaborator's presence state — cursor position, camera
 * viewport, display info. Populated reactively from Socket.IO events.
 */
export interface PeerMeta {
  id: string;
  username: string;
  color: string;
  cursor: CursorState | null;
  camera: PeerCamera | null;
}

// ---------------------------------------------------------------------------
// CollabState
// ---------------------------------------------------------------------------

export class CollabState {
  private _socket: Socket | null = null;
  private _yjsWs: WebSocket | null = null;
  private _yjsLayer: YjsLayer | null = null;
  private _undoManager: CollabUndoManager | null = null;
  private _peers: Map<string, PeerMeta> = new Map();
  private _localCursor: CursorState = { x: 0, y: 0 };
  private _roomKey: CryptoKey | null = null;
  private _onSceneUpdateCallback: ((elements: ExcalidrawElement[]) => void) | null = null;
  private _currentRoomId: string = "";

  // -------------------------------------------------------------------------
  // Snapshot pull state (Q-P5-1)
  // -------------------------------------------------------------------------
  // The joiner-pull election protocol: on `connect()`, this client requests
  // the current scene from a relay-elected peer. We accept SCENE_SNAPSHOT
  // only inside a 5 s post-connect window (`_joiningUntil`) and retry up to
  // 2 more times on 2 s timeouts.
  private _sceneAccessor: (() => ExcalidrawElement[] | null) | null = null;
  private _sceneReceiver: ((elements: ExcalidrawElement[]) => void) | null = null;
  private _joiningUntil: number = 0;
  private _snapshotRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private _snapshotAttempts: number = 0;
  private _snapshotApplied: boolean = false;
  private static readonly _SNAPSHOT_JOINING_WINDOW_MS = 5000;
  private static readonly _SNAPSHOT_RETRY_INTERVAL_MS = 2000;
  private static readonly _SNAPSHOT_MAX_ATTEMPTS = 3;

  /**
   * Whether realtime collaboration is enabled for this session. Set once in
   * the constructor from `getAppConfig().realtime.enabled` (reads Vite env var
   * `VITE_REALTIME_ENABLED`). When false, all connect/disconnect are no-ops.
   *
   * Plan contract (Q1): single-player deployment must function identically to
   * Phase 4 — zero WebSocket connections, zero collab UI.
   */
  readonly active: boolean;

  constructor() {
    const config = getAppConfig();
    this.active = config.realtime.enabled;
  }

  // -------------------------------------------------------------------------
  // Read-only state
  // -------------------------------------------------------------------------

  /** Map of peerId → PeerMeta for all currently-connected collaborators. */
  get peers(): Map<string, PeerMeta> {
    return this._peers;
  }

  /** Local cursor position in Excalidraw scene space. */
  get localCursor(): CursorState {
    return this._localCursor;
  }

  /**
   * The Y.Doc managed by this collab session. Created when `connect()` is
   * called; destroyed on `disconnect()`. Owned by `YjsLayer` for CRDT-native
   * data-layer operations (see `@atlasdraw/data` Task 4).
   *
   * Null before connect() or after disconnect().
   */
  get yjsDoc() {
    return this._yjsLayer?.doc ?? null;
  }

  /**
   * The CollabUndoManager for this collab session, scoped to local-origin ops
   * only so User A's undo never silently removes User B's work.
   *
   * Created when the Socket.IO connection establishes (so socket.id is known);
   * destroyed on `disconnect()`. Null before connection is established.
   *
   * All local Yjs mutations must be tagged with the local origin to be tracked:
   *   ydoc.transact(() => { addFeature(...); }, socket.id);
   *
   * See @atlasdraw/data CollabUndoManager (Phase 5 Task 12).
   */
  get undoManager(): CollabUndoManager | null {
    return this._undoManager;
  }

  /**
   * Register a callback invoked when a remote SCENE_UPDATE is received and
   * successfully decrypted. The callback receives the deserialized elements.
   *
   * Set to `null` to unregister.
   */
  set onSceneUpdate(callback: ((elements: ExcalidrawElement[]) => void) | null) {
    this._onSceneUpdateCallback = callback;
  }

  /**
   * Register a getter that returns the current Excalidraw scene elements.
   * Used by this client to serve REQUEST_SNAPSHOT (Q-P5-1) when the relay
   * elects this socket as the responder for a late joiner.
   *
   * The getter may return `null` if the Excalidraw imperative API has not
   * yet bound — in that case this client silently declines to serve and
   * the joiner's retry will route to the next eligible peer.
   *
   * Safe to call before `connect()`.
   */
  setSceneAccessor(fn: () => ExcalidrawElement[] | null): void {
    this._sceneAccessor = fn;
  }

  /**
   * Register a setter that applies received scene elements to Excalidraw.
   * Invoked exactly once on receipt of a valid SCENE_SNAPSHOT (Q-P5-1)
   * inside the 5 s joining window.
   *
   * The receiver owns the local merge strategy (LWW per-element-id by
   * Excalidraw's `reconcile` algorithm — see plan §Step 4 "Failure modes").
   * This class delivers decrypted elements verbatim; it does not mutate.
   *
   * Safe to call before `connect()`.
   */
  setSceneReceiver(fn: (elements: ExcalidrawElement[]) => void): void {
    this._sceneReceiver = fn;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Open both WebSocket connections for a collaborative room.
   *
   * @param roomId  Opaque room identifier (from URL fragment, see RoomKey).
   * @param key     AES-GCM CryptoKey for scene encryption (Tasks 8/10).
   */
  connect(roomId: string, key?: CryptoKey): void {
    if (!this.active) return;

    this._roomKey = key ?? null;
    this._currentRoomId = roomId;

    // URL resolution: same-origin when wsUrl is unset (the default for
    // local-only / Pages deployments that enable realtime).
    const config = getAppConfig();
    const wsUrl: string = config.realtime.wsUrl || window.location.origin;

    // -----------------------------------------------------------------------
    // Socket.IO connection — lightweight event channel
    // -----------------------------------------------------------------------
    this._socket = io(wsUrl, {
      transports: ["websocket"],
    });

    this._socket.on("connect", () => {
      this._socket?.emit("JOIN_ROOM", { roomId });

      // Phase 5 Task 12: Create CollabUndoManager with the socket.id as
      // local origin so undo only affects this client's data-layer ops.
      // All local Yjs mutations must be tagged with this origin via
      //   ydoc.transact(fn, socket.id)
      // to be tracked.
      if (this._yjsLayer) {
        this._undoManager = new CollabUndoManager(
          this._yjsLayer.doc,
          this._socket!.id,
        );
      }

      // Q-P5-1: open the 5 s joining window and pull a SCENE_SNAPSHOT from
      // the relay-elected peer. Retries up to 3 times total on a 2 s
      // interval; relay re-elects on each retry if the prior peer is gone.
      // Stops when (a) snapshot applied, (b) max attempts reached, or
      // (c) joining window closes.
      this._joiningUntil =
        Date.now() + CollabState._SNAPSHOT_JOINING_WINDOW_MS;
      this._snapshotAttempts = 0;
      this._snapshotApplied = false;
      this._sendSnapshotRequest();
    });

    // MAP_CAMERA_UPDATE: update peer viewport overlay only; do NOT apply to
    // local camera. OQ-5 resolution: per-client camera model (matches Figma/
    // Miro/Google Maps collab UX conventions). Remote viewport state is
    // rendered as ghost overlays by CursorOverlay / PresenceList (Task 11).
    this._socket.on(
      "MAP_CAMERA_UPDATE",
      (event: { senderId: string; data: PeerCamera }) => {
        const peer = this._peers.get(event.senderId);
        if (peer) {
          peer.camera = event.data;
        }
      },
    );

    // CURSOR — populate peers map from incoming cursor presence events.
    // Creates a PeerMeta entry if one does not yet exist for senderId.
    this._socket.on(
      "CURSOR",
      (event: {
        senderId: string;
        data: { x: number; y: number; color: string; username: string };
      }) => {
        let peer = this._peers.get(event.senderId);
        if (!peer) {
          peer = {
            id: event.senderId,
            username: event.data.username,
            color: event.data.color,
            cursor: null,
            camera: null,
          };
          this._peers.set(event.senderId, peer);
        }
        peer.cursor = { x: event.data.x, y: event.data.y };
      },
    );

    // SCENE_UPDATE — decrypt incoming encrypted scene payload and forward
    // decrypted elements to the registered callback (if any).
    this._socket.on(
      "SCENE_UPDATE",
      async (event: {
        senderId: string;
        data: { iv: string; ciphertext: string };
      }) => {
        if (!this._roomKey || !this._onSceneUpdateCallback) return;
        try {
          const elements = await decryptScene(event.data, this._roomKey);
          this._onSceneUpdateCallback(elements);
        } catch {
          // Decryption failed — payload may be tampered or key mismatch.
          // AES-GCM auth tag catches this; silently discard per ADR-0010.
        }
      },
    );

    // PEER_LEFT — remove the disconnecting peer from the presence map.
    this._socket.on(
      "PEER_LEFT",
      (data: { senderId: string }) => {
        this._peers.delete(data.senderId);
      },
    );

    // REQUEST_SNAPSHOT — Q-P5-1 sender-side. This client was elected by the
    // relay to serve a joiner. If we cannot (no scene accessor bound yet,
    // or no room key) we silently decline; the joiner's retry routes to
    // the next eligible peer. Envelope: { roomId, senderId, timestamp }
    // where `senderId` is the joiner's socket.id (relay-stamped).
    this._socket.on(
      "REQUEST_SNAPSHOT",
      async (event: {
        roomId: string;
        senderId: string;
        timestamp: number;
      }) => {
        if (!this._sceneAccessor || !this._roomKey || !this._socket) return;
        const elements = this._sceneAccessor() ?? [];
        try {
          const encrypted = await encryptScene(elements, this._roomKey);
          this._socket.emit("SCENE_SNAPSHOT", {
            roomId: this._currentRoomId,
            targetId: event.senderId,
            data: encrypted,
          });
        } catch {
          // Encrypt failure (e.g. key revoked) — silently decline. The
          // joiner's retry will route to the next eligible peer.
        }
      },
    );

    // SCENE_SNAPSHOT — Q-P5-1 joiner-side. Apply only if:
    //   (1) inside the 5 s joining window;
    //   (2) targetId matches our socket.id (defensive — relay should not
    //       address us if it's not for us, but verify);
    //   (3) room key available to decrypt.
    // Decrypt failure (AES-GCM auth tag) is silently discarded per ADR-0010.
    this._socket.on(
      "SCENE_SNAPSHOT",
      async (event: {
        roomId: string;
        senderId: string;
        timestamp: number;
        targetId: string;
        data: { iv: string; ciphertext: string };
      }) => {
        if (Date.now() > this._joiningUntil) return; // outside window
        if (event.targetId !== this._socket?.id) return; // not for us
        if (!this._roomKey) return;
        try {
          const elements = await decryptScene(event.data, this._roomKey);
          if (this._sceneReceiver) {
            this._sceneReceiver(elements);
          }
          // Stop retrying — snapshot applied (or at least delivered).
          this._snapshotApplied = true;
          if (this._snapshotRetryTimer !== null) {
            clearTimeout(this._snapshotRetryTimer);
            this._snapshotRetryTimer = null;
          }
        } catch {
          // Decrypt failure — silently discard per ADR-0010. Retry timer
          // continues to fire so the joiner can pull from another peer.
        }
      },
    );

    // -----------------------------------------------------------------------
    // Yjs WebSocket — CRDT data-layer sync channel (separate TCP, per Q9)
    //
    // Lifecycle only in Task 7. Actual y-protocols bidirectional sync is wired
    // by the useYjsLayer hook (Task 9). The WebSocket is held open here so
    // the relay's in-memory Y.Doc and room-join state is available when Task 9
    // calls setupWSConnection or the equivalent.
    // -----------------------------------------------------------------------
    this._yjsLayer = new YjsLayer();
    this._yjsWs = new WebSocket(`${wsUrl}/yjs/${roomId}`);

    this._yjsWs.onopen = () => {
      // WebSocket ready — Task 9 will bind Yjs sync here.
    };
    this._yjsWs.onerror = () => {
      // Yjs WS error — deferred to Task 9 error handling & retry.
    };
    this._yjsWs.onclose = () => {
      // Yjs WS closed — deferred to Task 9 reconnection logic.
    };
  }

  /**
   * Encrypt the current scene elements and broadcast as SCENE_UPDATE.
   *
   * Safe to call even before connect() — silently no-ops when the socket or
   * room key is unavailable.
   *
   * @param elements - The full Excalidraw element array to encrypt and emit.
   */
  async emitSceneUpdate(elements: ExcalidrawElement[]): Promise<void> {
    if (!this._socket?.connected || !this._roomKey) return;
    const encrypted = await encryptScene(elements, this._roomKey);
    this._socket.emit("SCENE_UPDATE", {
      roomId: this._currentRoomId,
      data: encrypted,
    });
  }

  /**
   * Tear down both WebSocket connections and destroy the Y.Doc.
   *
   * Safe to call even when `connect()` was never called (no-op if socket/Yjs
   * references are already null). Idempotent.
   */
  disconnect(): void {
    // Q-P5-1: cancel any pending snapshot retry and reset the joining state
    // so a subsequent connect() opens a fresh window.
    if (this._snapshotRetryTimer !== null) {
      clearTimeout(this._snapshotRetryTimer);
      this._snapshotRetryTimer = null;
    }
    this._joiningUntil = 0;
    this._snapshotAttempts = 0;
    this._snapshotApplied = false;

    this._socket?.close();
    this._socket = null;
    this._yjsWs?.close();
    this._yjsWs = null;
    this._undoManager = null;
    this._yjsLayer?.doc.destroy();
    this._yjsLayer = null;
    this._peers.clear();
  }

  // -------------------------------------------------------------------------
  // Internal — snapshot pull retry loop (Q-P5-1)
  // -------------------------------------------------------------------------

  /**
   * Emit REQUEST_SNAPSHOT and schedule the next retry on a 2 s timer.
   *
   * Stops retrying when any of:
   *   - max attempts reached (initial + 2 retries = 3 total);
   *   - the 5 s joining window has closed;
   *   - a SCENE_SNAPSHOT was received and applied;
   *   - the socket disconnects.
   */
  private _sendSnapshotRequest(): void {
    if (!this._socket?.connected) return;
    if (this._snapshotApplied) return;
    if (Date.now() > this._joiningUntil) return;
    if (this._snapshotAttempts >= CollabState._SNAPSHOT_MAX_ATTEMPTS) return;

    this._snapshotAttempts += 1;
    this._socket.emit("REQUEST_SNAPSHOT", {
      roomId: this._currentRoomId,
      senderId: this._socket.id,
      timestamp: Date.now(),
    });

    // Schedule the next retry. Cleared on snapshot-applied, disconnect, or
    // when the retry loop itself decides to stop.
    this._snapshotRetryTimer = setTimeout(() => {
      this._snapshotRetryTimer = null;
      this._sendSnapshotRequest();
    }, CollabState._SNAPSHOT_RETRY_INTERVAL_MS);
  }
}
