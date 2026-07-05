// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 Task 7 — CollabState lifecycle (client-side).
//
// Thin facade composing three independent channels: SceneChannel
// (Socket.IO presence/crypto/snapshot-pull), YjsChannel (Yjs CRDT
// data-layer WebSocket + undo), and CommentsChannel (anchored-comments
// Y.Doc). Opens/closes all three together, reads the room key from the
// URL fragment, and degrades gracefully when realtime is disabled (Q1).
//
// DEADWOOD.md god-module split: this class was a single 585-line class
// owning all three channels' fields and methods directly; each channel now
// owns its own lifecycle and CollabState only orchestrates. Its public
// interface is unchanged from before the split, so every existing consumer
// (useCollab, useCollabRoom, useYjsLayer, ShareDialog, MapEditor) and
// collab.test.ts needed no changes.
//
// Flow position: Step 1 of 3 in client-collab (config → collab-state → UI).
// Upstream contract: receives RealtimeConfig from getAppConfig().realtime.
// Downstream contract: CollabState consumed by useCollab hook (Task 7 Step 2),
//   CursorOverlay (Task 11), PresenceList (Task 11), useYjsLayer (Task 9).
//
// OQ-5 resolution: per-client camera model. Remote MAP_CAMERA_UPDATE events
// are stored as peer viewport overlays only — local camera is never updated.

import type { CollabUndoManager } from "@atlasdraw/data";
import type { ExcalidrawElement } from "@atlasdraw/excalidraw";

import { getAppConfig } from "../config/app-config";

import { CommentsChannel } from "./commentsChannel";
import { YjsChannel } from "./yjsChannel";
import { SceneChannel } from "./sceneChannel";

import type { CommentsLayer } from "./comments";
import type { CursorState, PeerMeta } from "./sceneChannel";

export type { CursorState, PeerCamera, PeerMeta } from "./sceneChannel";

/**
 * Plain-data snapshot of CollabState's reactive fields (ISSUES.md Issue 9).
 * Cached by `getSnapshot()` and only rebuilt when a channel calls back via
 * `_notify()` — the stable reference between real changes is required by
 * `useSyncExternalStore`, which the React-facing consumers use to actually
 * re-render on peer/doc changes (a plain `Map.set()` on `peers` is otherwise
 * invisible to React).
 */
export interface CollabSnapshot {
  peers: Map<string, PeerMeta>;
  localCursor: CursorState;
  yjsDoc: import("yjs").Doc | null;
  commentsLayer: CommentsLayer | null;
}

// ---------------------------------------------------------------------------
// CollabState
// ---------------------------------------------------------------------------

export class CollabState {
  private _listeners = new Set<() => void>();
  private _snapshot: CollabSnapshot | null = null;

  private _notify = (): void => {
    this._snapshot = null;
    for (const listener of this._listeners) {
      listener();
    }
  };

  private _sceneChannel: SceneChannel = new SceneChannel(this._notify);
  private _yjsChannel: YjsChannel = new YjsChannel(this._notify);
  // Phase 6 A3 — anchored comments live in a separate Y.Doc with its own
  // WebSocket connection (different docName, different ACL granularity).
  // Lifecycle bound to connect()/disconnect(). Extracted to CommentsChannel.
  private _commentsChannel: CommentsChannel = new CommentsChannel(this._notify);

  /**
   * React (`useSyncExternalStore`) subscription hook — registers `listener`
   * to be called after any peers/yjsDoc/commentsLayer change. Returns an
   * unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /**
   * Stable-reference snapshot of the reactive fields, rebuilt lazily after
   * `_notify()` invalidates the cache. Pass directly as `useSyncExternalStore`'s
   * `getSnapshot` (bound as a class field, so it's safe to pass by reference).
   */
  getSnapshot = (): CollabSnapshot => {
    if (!this._snapshot) {
      this._snapshot = {
        peers: this._sceneChannel.peers,
        localCursor: this._sceneChannel.localCursor,
        yjsDoc: this._yjsChannel.doc,
        commentsLayer: this._commentsChannel.layer,
      };
    }
    return this._snapshot;
  };

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
    return this._sceneChannel.peers;
  }

  /** Local cursor position in Excalidraw scene space. */
  get localCursor(): CursorState {
    return this._sceneChannel.localCursor;
  }

  /**
   * The Y.Doc managed by this collab session. Created when `connect()` is
   * called; destroyed on `disconnect()`. Owned by `YjsLayer` for CRDT-native
   * data-layer operations (see `@atlasdraw/data` Task 4).
   *
   * Null before connect() or after disconnect().
   */
  get yjsDoc() {
    return this._yjsChannel.doc;
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
    return this._yjsChannel.undoManager;
  }

  /**
   * Register a callback invoked when a remote SCENE_UPDATE is received and
   * successfully decrypted. The callback receives the deserialized elements.
   *
   * Set to `null` to unregister.
   */
  set onSceneUpdate(
    callback: ((elements: ExcalidrawElement[]) => void) | null,
  ) {
    this._sceneChannel.onSceneUpdate = callback;
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
    this._sceneChannel.setSceneAccessor(fn);
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
    this._sceneChannel.setSceneReceiver(fn);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * The comments Y.Doc layer for this collab session. Created when
   * `connect()` is called with a roomId; destroyed on `disconnect()`.
   *
   * When no collab session is active (connect() never called), a local-only
   * layer is created lazily so solo users can author comments without a
   * shared room. The local layer has no WebSocket provider; comments are
   * persisted to localStorage so they survive page refresh.
   *
   * Phase 6 A3 — anchored comments. Distinct from `yjsDoc` (data layer).
   * See `state/comments.ts` and ADR-0010 trust posture.
   */
  get commentsLayer(): CommentsLayer | null {
    return this._commentsChannel.layer;
  }

  /**
   * Open all three channels for a collaborative room: the Socket.IO scene
   * channel, the Yjs data-layer WebSocket, and the anchored-comments Y.Doc.
   *
   * @param roomId       Opaque room identifier (from URL fragment, see RoomKey).
   * @param key          AES-GCM CryptoKey for scene encryption (Tasks 8/10).
   * @param workspaceId  Phase 6 A9 workspace scope; null/undefined for
   *                     self-host / Phase-5-compatible behavior.
   */
  connect(roomId: string, key?: CryptoKey, workspaceId?: string | null): void {
    if (!this.active) {
      return;
    }

    // URL resolution: same-origin when wsUrl is unset (the default for
    // local-only / Pages deployments that enable realtime).
    const config = getAppConfig();
    const wsUrl: string = config.realtime.wsUrl || window.location.origin;

    // Phase 5 Task 12: attach the CollabUndoManager once the scene socket's
    // "connect" event produces the local-origin id. All local Yjs mutations
    // must be tagged with this origin via ydoc.transact(fn, socketId) to be
    // tracked.
    this._sceneChannel.connect(wsUrl, roomId, key, (socketId) => {
      this._yjsChannel.attachUndo(socketId);
    });

    this._yjsChannel.connect(wsUrl, roomId);

    // Phase 6 A3 — anchored comments Y.Doc on a separate WebSocket. Distinct
    // docName (`comments/${roomId}` or `comments/${workspaceId}/${roomId}`)
    // — see protocol/comment-schema.ts. Trust posture: plaintext on relay
    // per ADR-0010 (same as data-layer doc).
    this._commentsChannel.connect(wsUrl, roomId, workspaceId ?? null);
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
    return this._sceneChannel.emitSceneUpdate(elements);
  }

  /**
   * Tear down all three channels. Safe to call even when `connect()` was
   * never called (each channel's disconnect() is independently idempotent).
   */
  disconnect(): void {
    this._sceneChannel.disconnect();
    this._yjsChannel.disconnect();
    this._commentsChannel.disconnect();
  }
}
