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
import { YjsLayer } from "@atlasdraw/data";
import { getAppConfig } from "../config/app-config";

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
  private _peers: Map<string, PeerMeta> = new Map();
  private _localCursor: CursorState = { x: 0, y: 0 };

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

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Open both WebSocket connections for a collaborative room.
   *
   * @param roomId  Opaque room identifier (from URL fragment, see RoomKey).
   * @param _key    AES-GCM CryptoKey for scene encryption (reserved; used by
   *                Tasks 8/10 — not wired in Task 7).
   */
  connect(roomId: string, _key?: CryptoKey): void {
    if (!this.active) return;

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

    // PEER_LEFT — remove the disconnecting peer from the presence map.
    this._socket.on(
      "PEER_LEFT",
      (data: { senderId: string }) => {
        this._peers.delete(data.senderId);
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
   * Tear down both WebSocket connections and destroy the Y.Doc.
   *
   * Safe to call even when `connect()` was never called (no-op if socket/Yjs
   * references are already null).
   */
  disconnect(): void {
    this._socket?.close();
    this._socket = null;
    this._yjsWs?.close();
    this._yjsWs = null;
    this._yjsLayer?.doc.destroy();
    this._yjsLayer = null;
    this._peers.clear();
  }
}
