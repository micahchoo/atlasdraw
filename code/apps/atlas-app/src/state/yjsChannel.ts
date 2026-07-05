// SPDX-License-Identifier: AGPL-3.0-only
//
// Yjs WebSocket — CRDT data-layer sync channel (separate TCP, per Q9).
//
// Lifecycle only: actual y-protocols bidirectional sync is wired by the
// useYjsLayer hook (Task 9). The WebSocket is held open here so the relay's
// in-memory Y.Doc and room-join state is available when useYjsLayer calls
// setupWSConnection or the equivalent.
//
// Extracted from state/collab.ts's CollabState class (DEADWOOD.md god-module
// split, collab.ts Cut 2). The one cross-module wire from the original class:
// CollabUndoManager needs both the Socket.IO socket's id (as local origin,
// known only once the socket "connect" event fires) and this channel's
// Y.Doc. Resolved via `attachUndo(originId)`, called by CollabState from its
// own socket "connect" handler once `socket.id` is available — this channel
// never reaches into the socket itself.

import { YjsLayer, CollabUndoManager } from "@atlasdraw/data";

import type * as Y from "yjs";

export class YjsChannel {
  private _ws: WebSocket | null = null;
  private _layer: YjsLayer | null = null;
  private _undoManager: CollabUndoManager | null = null;

  /**
   * The Y.Doc managed by this channel. Created when `connect()` is called;
   * destroyed on `disconnect()`. Null before connect() or after disconnect().
   */
  get doc(): Y.Doc | null {
    return this._layer?.doc ?? null;
  }

  /**
   * The CollabUndoManager for this session, scoped to local-origin ops only
   * so User A's undo never silently removes User B's work. Null until
   * `attachUndo()` is called (requires the socket's local origin id);
   * null again after `disconnect()`.
   */
  get undoManager(): CollabUndoManager | null {
    return this._undoManager;
  }

  /** Open the Yjs WebSocket and create a fresh YjsLayer for `roomId`. */
  connect(wsUrl: string, roomId: string): void {
    this._layer = new YjsLayer();
    this._ws = new WebSocket(`${wsUrl}/yjs/${roomId}`);

    this._ws.onopen = () => {
      // WebSocket ready — useYjsLayer binds Yjs sync here.
    };
    this._ws.onerror = () => {
      // Yjs WS error — deferred to useYjsLayer's error handling & retry.
    };
    this._ws.onclose = () => {
      // Yjs WS closed — deferred to useYjsLayer's reconnection logic.
    };
  }

  /**
   * Create the CollabUndoManager once the Socket.IO local origin id is
   * known (fired from CollabState's socket "connect" handler). Accepts
   * `undefined` because `Socket.id` is typed `string | undefined` in this
   * socket.io-client version; CollabUndoManager's `localOrigin` is `unknown`
   * so this is a pass-through, not a widening of its real contract. No-ops
   * if `connect()` hasn't created a Y.Doc yet.
   */
  attachUndo(originId: string | undefined): void {
    if (this._layer) {
      this._undoManager = new CollabUndoManager(this._layer.doc, originId);
    }
  }

  /** Tear down the WebSocket and destroy the Y.Doc. Idempotent. */
  disconnect(): void {
    this._ws?.close();
    this._ws = null;
    this._undoManager = null;
    this._layer?.doc.destroy();
    this._layer = null;
  }
}
