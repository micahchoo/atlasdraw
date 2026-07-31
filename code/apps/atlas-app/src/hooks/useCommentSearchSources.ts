// SPDX-License-Identifier: AGPL-3.0-only
// Comment text, made findable from the canvas search box.
//
// Comments live in their own Y.Doc up here in atlas-app; the search menu lives
// down in the vendored editor and cannot reach them. The `searchSources` prop
// (packages/excalidraw/types.ts) is the seam: we hand over plain text plus a
// callback, and the editor keeps ownership of matching, previewing and
// counting — so a comment hit reads exactly like a text-element hit.
//
// Picking one does two things:
//   * moves the viewport to the anchor — map.flyTo for a map anchor,
//     scrollToContent for an element anchor;
//   * opens that anchor's popover, via state/commentFocus.ts.
//
// Resolved comments are excluded, matching CommentsPanel's default filter
// (`showResolved` starts false). A resolved thread is closed business; making
// it turn up in search would put the two surfaces at odds about what a
// comment list means.
//
// The returned array is memoized because <Excalidraw> is React.memo'd on a
// shallow prop compare — a fresh array per render would re-render the editor
// on every keystroke anywhere in the app.

import { useEffect, useMemo, useState } from "react";

import type {
  ExcalidrawImperativeAPI,
  SearchSource,
} from "@atlasdraw/excalidraw/types";

import { focusComment } from "../state/commentFocus";

import { isOpenThread } from "./useOpenThreadCount";

import type { Comment, CommentsLayer } from "../state/comments";
import type maplibregl from "maplibre-gl";

/** Group id + heading for the comments source. */
export const COMMENT_SEARCH_SOURCE_ID = "comments";

interface CommentSearchSourcesArgs {
  commentsLayer: CommentsLayer | null;
  map: maplibregl.Map | null;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

/**
 * Live, memoized `searchSources` for `<Excalidraw>`.
 *
 * `undefined` — not an empty array — when there is nothing to search, so the
 * editor takes its untouched fast path. There is nothing to search whenever
 * collab is off: `CommentsLayer` is created by `CollabState.connect`, so a
 * solo sheet has no comments doc at all. That is not a regression, just an
 * empty well.
 */
export function useCommentSearchSources({
  commentsLayer,
  map,
  excalidrawAPI,
}: CommentSearchSourcesArgs): readonly SearchSource[] | undefined {
  const [comments, setComments] = useState<ReadonlyArray<Comment>>(() =>
    commentsLayer ? commentsLayer.comments : [],
  );

  useEffect(() => {
    if (!commentsLayer) {
      setComments([]);
      return;
    }
    setComments(commentsLayer.comments);
    return commentsLayer.subscribe(setComments);
  }, [commentsLayer]);

  return useMemo(() => {
    const open = comments.filter(isOpenThread);
    if (open.length === 0) {
      return undefined;
    }

    return [
      {
        id: COMMENT_SEARCH_SOURCE_ID,
        label: "Comments",
        entries: open.map((comment) => ({
          id: comment.id,
          text: comment.text,
          onSelect: () => {
            revealAnchor(comment, map, excalidrawAPI);
            focusComment(comment.id);
          },
        })),
      },
    ];
  }, [comments, map, excalidrawAPI]);
}

/**
 * Move the viewport so the comment's anchor is on screen.
 *
 * Silent when the surface it needs is missing — a map anchor with no map, or
 * an element anchor whose element has since been deleted. The popover still
 * opens in that case (comment text is worth reading even when its subject is
 * gone), so this failing does not swallow the whole interaction.
 */
function revealAnchor(
  comment: Comment,
  map: maplibregl.Map | null,
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): void {
  if (comment.anchor.kind === "map") {
    map?.flyTo({ center: [comment.anchor.lng, comment.anchor.lat] });
    return;
  }

  // `scrollToContent` takes an element id and returns silently on an unknown
  // one (App.tsx:4557 — empty `getElementsFromId`, and a non-link id skips the
  // toast), so no existence check is needed. `duration` is deliberately absent:
  // the string branch recurses with fitToContent + animate only and drops it.
  excalidrawAPI?.scrollToContent(comment.anchor.elementId, {
    fitToContent: true,
    animate: true,
  });
}
