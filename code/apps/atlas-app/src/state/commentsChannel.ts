// SPDX-License-Identifier: AGPL-3.0-only
//
// Phase 6 A3 — anchored comments live in a separate Y.Doc with its own
// WebSocket connection (different docName, different ACL granularity) than
// the data-layer doc. Lifecycle bound to connect()/disconnect().
//
// Extracted from state/collab.ts's CollabState class (DEADWOOD.md god-module
// split, collab.ts Cut 1) — the cleanest of the three channels: near-zero
// coupling to the socket/crypto/snapshot machinery, depends only on
// getAppConfig, localStorage, and the roomId/workspaceId args passed to
// connect(). No test covered this concern directly before extraction; new
// commentsChannel.test.ts adds characterization coverage.

import * as Y from "yjs";

import { COMMENTS_ARRAY_KEY, type CommentSchemaV1 } from "@atlasdraw/protocol";

import { getAppConfig } from "../config/app-config";

import { CommentsLayer } from "./comments";

const LOCAL_STORAGE_KEY = "atlasdraw:comments:local";

export class CommentsChannel {
  private _layer: CommentsLayer | null = null;

  /**
   * The comments Y.Doc layer for this collab session.
   *
   * When no collab session is active (connect() never called), a local-only
   * layer is created lazily so solo users can author comments without a
   * shared room. The local layer has no WebSocket provider; comments are
   * persisted to localStorage so they survive page refresh.
   */
  get layer(): CommentsLayer {
    if (!this._layer) {
      const config = getAppConfig();

      // Restore persisted comments into a pre-populated Y.Doc.
      let doc: Y.Doc | undefined;
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        try {
          const saved: CommentSchemaV1[] = JSON.parse(raw);
          if (saved.length > 0) {
            doc = new Y.Doc();
            const arr = doc.getArray<Y.Map<unknown>>(COMMENTS_ARRAY_KEY);
            doc.transact(() => {
              for (const c of saved) {
                const m = new Y.Map<unknown>();
                for (const [k, v] of Object.entries(c)) {
                  if (k === "anchor" && typeof v === "object" && v !== null) {
                    const a = new Y.Map<unknown>();
                    for (const [ak, av] of Object.entries(
                      v as Record<string, unknown>,
                    )) {
                      a.set(ak, av);
                    }
                    m.set("anchor", a);
                  } else {
                    m.set(k, v);
                  }
                }
                arr.push([m]);
              }
            });
          }
        } catch {
          // Corrupt data — start fresh.
        }
      }

      this._layer = new CommentsLayer({
        wsUrl: config.realtime.wsUrl || "http://localhost",
        roomId: "local",
        workspaceId: null,
        providerFactory: () => null,
        doc,
      });

      // Persist on every change so comments survive page refresh.
      this._layer.subscribe((comments) => {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(comments));
      });
    }
    return this._layer;
  }

  /**
   * Replace any local-only layer with a real collab layer bound to `roomId`.
   * Destroys the prior layer first (avoids a Y.Doc memory leak).
   */
  connect(wsUrl: string, roomId: string, workspaceId: string | null): void {
    this._layer?.destroy();
    this._layer = new CommentsLayer({ wsUrl, roomId, workspaceId });
  }

  /** Tear down the Y.Doc + provider. Idempotent. */
  disconnect(): void {
    this._layer?.destroy();
    this._layer = null;
  }
}
