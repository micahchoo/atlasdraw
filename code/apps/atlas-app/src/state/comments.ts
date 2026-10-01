// SPDX-License-Identifier: AGPL-3.0-only
//
// CommentsLayer: the comments of one document, kept in a Y.Doc array of
// Y.Maps (protocol/comment-schema.ts). The document owns the Y.Doc. For a
// map of the user's own it is private to the Document; in a room it is the
// room's Y.Doc, so comments sync with everything else in the room.
//
// This is the React-facing seam: a stable observer API (`subscribe`), the
// mutators, and plain-object snapshots.

import * as Y from "yjs";
import {
  COMMENTS_ARRAY_KEY,
  COMMENT_SCHEMA_VERSION,
  type CommentAnchor,
  type CommentSchemaV1,
} from "@atlasdraw/protocol";

import { checkComment, rejectFrom, writerOfType } from "./roomValidation";

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

type Listener = (comments: ReadonlyArray<Comment>) => void;
/**
 * fires once per newly-arrived comment, after the initial
 * sync window. Used by aria-live announcers; not used by render code.
 */
type AdditionListener = (comment: Comment) => void;

export class CommentsLayer {
  readonly doc: Y.Doc;
  private readonly _observer: () => void;
  private readonly _listeners: Set<Listener> = new Set();
  private readonly _additionListeners: Set<AdditionListener> = new Set();
  private _cachedSnapshot: ReadonlyArray<Comment> = [];
  /**
   * wall-clock timestamp captured at construction. Any
   * comment whose `createdAt` is older than this is considered "already
   * present at sync time" and is NOT announced as a new arrival. This
   * suppresses the initial replay storm that y-websocket fires when the
   * relay returns the room's existing CRDT state.
   *
   * Limitations:
   *   - clock-skew between clients can over- or under-include announcements
   *     by a few seconds; acceptable noise for an aria-live polite hint.
   *   - if a stale offline write replays from another tab with a createdAt
   *     in the past, it will not announce. Also acceptable.
   */
  private readonly _syncedAt: number;
  /** Ids we've already announced — Y.Array.observeDeep can fire repeatedly. */
  private readonly _announcedIds: Set<string> = new Set();

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this._syncedAt = Date.now();

    // Observe deep so anchor-nested Y.Maps also trigger.
    this._observer = () => {
      this._cachedSnapshot = this._compute();
      // Fire generic snapshot listeners.
      for (const l of this._listeners) {
        l(this._cachedSnapshot);
      }
      // addition listeners. We announce only comments
      // we've never seen before AND whose `createdAt` is newer than the
      // sync window (suppresses replay storm of pre-existing comments
      // when the relay sends the initial state).
      if (this._additionListeners.size > 0) {
        for (const c of this._cachedSnapshot) {
          if (this._announcedIds.has(c.id)) {
            continue;
          }
          this._announcedIds.add(c.id);
          if (c.createdAt < this._syncedAt) {
            continue;
          }
          for (const l of this._additionListeners) {
            l(c);
          }
        }
      } else {
        // Even without listeners, mark seen ids so a late-binding listener
        // doesn't suddenly announce a flood of old comments.
        for (const c of this._cachedSnapshot) {
          this._announcedIds.add(c.id);
        }
      }
    };
    this._array().observeDeep(this._observer);

    // Seed the snapshot for the first subscriber.
    this._cachedSnapshot = this._compute();
    // Treat any comments present at construction as "already synced" —
    // don't announce them later if an addition listener attaches.
    for (const c of this._cachedSnapshot) {
      this._announcedIds.add(c.id);
    }
  }

  /**
   * Subscribe to NEW comments (not the full snapshot). The
   * listener fires once per id, and only for comments whose createdAt is at
   * or after the sync window (`Date.now()` at construction). Returns an
   * unsubscribe function. Used by aria-live announcers.
   */
  subscribeAdditions(listener: AdditionListener): () => void {
    this._additionListeners.add(listener);
    return () => {
      this._additionListeners.delete(listener);
    };
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
    this._array().push([commentMap(row)]);
    return id;
  }

  /** Replace the comment text. No-op if id not present or text is empty. */
  editComment(commentId: string, newText: string): void {
    if (!newText.trim()) {
      return;
    }
    const idx = this._indexOf(commentId);
    if (idx === -1) {
      return;
    }
    this._array().get(idx).set("text", newText.trim());
  }

  /** Flip `resolved` to true on the matching id. No-op if id not present. */
  resolve(commentId: string): void {
    const idx = this._indexOf(commentId);
    if (idx === -1) {
      return;
    }
    const m = this._array().get(idx);
    m.set("resolved", true);
  }

  /**
   * Remove the comment from the Y.Array. No soft-delete. Only the UI keeps
   * a user to their own comments (by `identity.id`); anyone in a room can
   * write the room doc.
   */
  delete(commentId: string): void {
    const idx = this._indexOf(commentId);
    if (idx === -1) {
      return;
    }
    this._array().delete(idx, 1);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Stop observing the Y.Doc. The doc itself belongs to its owner. */
  destroy(): void {
    this._listeners.clear();
    this._additionListeners.clear();
    this._array().unobserveDeep(this._observer);
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
      const m: unknown = arr.get(i);
      if (m instanceof Y.Map && m.get("id") === commentId) {
        return i;
      }
    }
    return -1;
  }

  /**
   * The valid rows. In a room any client can write the array, so a row is
   * checked first (roomValidation.ts#checkComment); a row that fails is
   * skipped. A v1 `{ kind: "element" }` anchor reads as the v2 canonical
   * `{ kind: "annotation", source: "element" }`.
   */
  private _compute(): ReadonlyArray<Comment> {
    const arr = this._array();
    const out: Comment[] = [];
    for (let i = 0; i < arr.length; i++) {
      const m: unknown = arr.get(i);
      const a = m instanceof Y.Map ? m.get("anchor") : undefined;
      const comment =
        m instanceof Y.Map
          ? checkComment(
              (key) => m.get(key),
              a instanceof Y.Map ? Object.fromEntries(a.entries()) : null,
            )
          : null;
      if (comment) {
        out.push(comment);
      } else {
        rejectFrom(this.doc, writerOfType(m), "comment");
      }
    }
    return out;
  }

  private _mintId(): string {
    // Lightweight uuid-shape — globally unique enough for Yjs row keys.
    // Avoids a `uuid` dep (constraint: no new deps).
    const rand = (): string =>
      Math.floor(Math.random() * 0xffffffff)
        .toString(16)
        .padStart(8, "0");
    return `${rand()}-${rand()}`;
  }
}

/** A comment as the Y.Map the array holds; the anchor is a nested Y.Map. */
function commentMap(row: Comment): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(row)) {
    if (k === "anchor") {
      const a = new Y.Map<unknown>();
      for (const [ak, av] of Object.entries(v as object)) {
        a.set(ak, av);
      }
      m.set("anchor", a);
    } else {
      m.set(k, v);
    }
  }
  return m;
}

/** Append `comments` to the comments array of `doc`, in one transaction. */
export function seedComments(
  doc: Y.Doc,
  comments: readonly Comment[],
  origin?: unknown,
): void {
  if (comments.length === 0) {
    return;
  }
  doc.transact(() => {
    doc
      .getArray<Y.Map<unknown>>(COMMENTS_ARRAY_KEY)
      .push(comments.map(commentMap));
  }, origin);
}
