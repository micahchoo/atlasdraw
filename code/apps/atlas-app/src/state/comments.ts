// SPDX-License-Identifier: AGPL-3.0-only
// atlas-app — Phase 6 A3 anchored-comment client state.
//
// CommentsLayer wraps a Y.Doc + y-websocket WebsocketProvider for a single
// room's comments. The doc lives on the relay at the URL path produced by
// `buildCommentsDocPath(roomId, workspaceId)` — see protocol/comment-schema.ts
// for the document shape and ADR-0010 trust posture.
//
// Lifecycle is owned by CollabState: when CollabState.connect(roomId, key,
// workspaceId) opens the data-layer Yjs WebSocket, it also instantiates a
// CommentsLayer; CollabState.disconnect() tears it down.
//
// This module is the React-facing seam: it exposes a stable observer API
// (`subscribe(listener) → unsubscribe`) that components turn into useSyncExternalStore
// state, plus mutation helpers (addComment, resolve, delete).
//
// Plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A3
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import {
  COMMENTS_ARRAY_KEY,
  COMMENT_SCHEMA_VERSION,
  buildCommentsDocPath,
  type CommentAnchor,
  type CommentSchemaV1,
} from "@atlasdraw/protocol";

// ---------------------------------------------------------------------------
// Public-facing comment record (plain object)
//
// The Y.Map wire form (per protocol/comment-schema.ts) carries the same keys
// but nests `anchor` as a nested Y.Map. CommentsLayer converts in both
// directions so React consumers always see plain objects.
// ---------------------------------------------------------------------------
export type Comment = CommentSchemaV1;

// ---------------------------------------------------------------------------
// CommentsLayer
// ---------------------------------------------------------------------------

export interface CommentsLayerOptions {
  /** WebSocket base URL — same shape CollabState resolves from RealtimeConfig. */
  wsUrl: string;
  /** Room identifier (Q-P5-2). */
  roomId: string;
  /** Workspace scope; null for self-host / Phase-5-compatible deployments. */
  workspaceId: string | null;
  /**
   * Optional injected Y.Doc — tests pass two docs and bypass the provider
   * to exercise CRDT semantics without a WebSocket. Production code omits
   * this and gets a fresh doc.
   */
  doc?: Y.Doc;
  /**
   * Optional injected WebsocketProvider factory — tests pass a no-op factory
   * to exercise pure CRDT semantics; production uses the real provider.
   */
  providerFactory?: (
    wsUrl: string,
    docName: string,
    doc: Y.Doc,
  ) => { destroy: () => void } | null;
}

type Listener = (comments: ReadonlyArray<Comment>) => void;

export class CommentsLayer {
  readonly doc: Y.Doc;
  private readonly _provider: { destroy: () => void } | null;
  private readonly _listeners: Set<Listener> = new Set();
  private _cachedSnapshot: ReadonlyArray<Comment> = [];

  constructor(opts: CommentsLayerOptions) {
    this.doc = opts.doc ?? new Y.Doc();

    // The y-websocket WebsocketProvider expects a base URL and a room name;
    // it appends `/${roomName}` itself, which collides with our docName-as-URL-path
    // contract. To get a docName like `comments/room-abc` we set the room name
    // to that path and let the relay treat the suffix verbatim.
    const docName = buildCommentsDocPath(opts.roomId, opts.workspaceId).slice(
      "/yjs/".length,
    );

    if (opts.providerFactory) {
      this._provider = opts.providerFactory(opts.wsUrl, docName, this.doc);
    } else if (typeof WebSocket !== "undefined") {
      // Strip trailing slash so y-websocket's concatenation
      // (`${url}/${roomName}/...`) lands on /yjs/<docName>.
      const base = opts.wsUrl.replace(/\/+$/, "");
      // WebsocketProvider's first arg is the base URL; it joins `/${roomname}`.
      // We pass `/yjs` as the base so the final URL is /yjs/<docName>.
      this._provider = new WebsocketProvider(
        `${base}/yjs`,
        docName,
        this.doc,
        { connect: true },
      );
    } else {
      this._provider = null;
    }

    // Observe deep so anchor-nested Y.Maps also trigger.
    const arr = this._array();
    arr.observeDeep(() => {
      this._cachedSnapshot = this._compute();
      for (const l of this._listeners) l(this._cachedSnapshot);
    });

    // Seed the snapshot for the first subscriber.
    this._cachedSnapshot = this._compute();
  }

  // -------------------------------------------------------------------------
  // Read API
  // -------------------------------------------------------------------------

  /** Current snapshot (chronological order — insertion order on the Y.Array). */
  get comments(): ReadonlyArray<Comment> {
    return this._cachedSnapshot;
  }

  /**
   * Subscribe to comment-list changes. Listener fires on every Yjs mutation
   * (local or remote). Returns an unsubscribe function. The listener is NOT
   * invoked synchronously on subscribe — read `.comments` to get the initial
   * snapshot.
   */
  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Mutators
  // -------------------------------------------------------------------------

  /**
   * Append a new comment. The id is generated client-side (uuid-shaped slug,
   * no auth in v1 per Q-P6-1). Returns the generated id.
   */
  addComment(input: {
    text: string;
    anchor: CommentAnchor;
    authorId: string;
    authorName: string;
  }): string {
    const id = this._mintId();
    const row: CommentSchemaV1 = {
      id,
      authorId: input.authorId,
      authorName: input.authorName,
      text: input.text,
      createdAt: Date.now(),
      anchor: input.anchor,
      resolved: false,
      schemaVersion: COMMENT_SCHEMA_VERSION,
    };
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(row)) {
      if (k === "anchor") {
        const a = new Y.Map<unknown>();
        for (const [ak, av] of Object.entries(v as object)) a.set(ak, av);
        m.set("anchor", a);
      } else {
        m.set(k, v);
      }
    }
    this._array().push([m]);
    return id;
  }

  /** Flip `resolved` to true on the matching id. No-op if id not present. */
  resolve(commentId: string): void {
    const idx = this._indexOf(commentId);
    if (idx === -1) return;
    const m = this._array().get(idx);
    m.set("resolved", true);
  }

  /**
   * Remove the comment from the Y.Array. LWW; no soft-delete.
   *
   * Authorization (delete-own-only) is enforced client-side by the UI —
   * authorId rotates on socket reconnect, so this is best-effort. Phase 7
   * is expected to introduce a stable user identity; see TODO in
   * components/CommentsPanel.tsx.
   */
  delete(commentId: string): void {
    const idx = this._indexOf(commentId);
    if (idx === -1) return;
    this._array().delete(idx, 1);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  destroy(): void {
    this._listeners.clear();
    this._provider?.destroy();
    this.doc.destroy();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private _array(): Y.Array<Y.Map<unknown>> {
    return this.doc.getArray<Y.Map<unknown>>(COMMENTS_ARRAY_KEY);
  }

  private _indexOf(commentId: string): number {
    const arr = this._array();
    for (let i = 0; i < arr.length; i++) {
      if (arr.get(i).get("id") === commentId) return i;
    }
    return -1;
  }

  private _compute(): ReadonlyArray<Comment> {
    const arr = this._array();
    const out: Comment[] = [];
    for (let i = 0; i < arr.length; i++) {
      const m = arr.get(i);
      const a = m.get("anchor") as Y.Map<unknown> | undefined;
      const anchor: CommentAnchor =
        a !== undefined
          ? (Object.fromEntries(a.entries()) as CommentAnchor)
          : ({ kind: "map", lng: 0, lat: 0 } as CommentAnchor);
      out.push({
        id: (m.get("id") as string) ?? "",
        authorId: (m.get("authorId") as string) ?? "",
        authorName: (m.get("authorName") as string) ?? "",
        text: (m.get("text") as string) ?? "",
        createdAt: (m.get("createdAt") as number) ?? 0,
        anchor,
        resolved: (m.get("resolved") as boolean) ?? false,
        schemaVersion: COMMENT_SCHEMA_VERSION,
      });
    }
    return out;
  }

  private _mintId(): string {
    // Lightweight uuid-shape — globally unique enough for Yjs row keys.
    // Avoids a `uuid` dep (constraint: no new deps).
    const rand = (): string =>
      Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
    return `${rand()}-${rand()}`;
  }
}
