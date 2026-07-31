// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — CommentAnchorsOverlay.
//
// Iterates the live CommentsLayer.comments list and renders one
// <CommentAnchor /> per row, projected to screen-space coordinates:
//
//   - map anchors:     map.project([lng, lat]) → screen pixels; re-projected
//                      on every map move + zoomend.
//   - annotation anchors (element / raster): sceneCoordsToViewportCoords (from
//                      @atlasdraw/common — verified at
//                      code/packages/common/src/utils.ts:439) on the element's
//                      bounding-box top-right, or map.project of the raster's
//                      corner centroid; re-projected on Excalidraw
//                      scrollX/scrollY/zoom changes and map moves.
//
// While comment mode is active and no anchor is pending, a full-overlay
// click-intercept div captures every click and runs the hit-test cascade —
// Excalidraw element → raster layer → bare map point — publishing the result
// as the pendingAnchor (annotation form on a hit, map form otherwise). This
// replaces the old map.once("click") and element-selection pickers: the whole
// gesture happens on the plate.
//
// Mounted by MapEditor as a sibling of the Excalidraw canvas. Pointer events
// are scoped to the rendered anchors themselves and the transient intercept
// (z-index 10 per atlasdraw-ui-conventions) — the surrounding container is
// pointer-events:none.
//
// Plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A3
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React, { useEffect, useState } from "react";

import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@atlasdraw/common";

import {
  normalizeAnchor,
  type CommentAnchor as CommentAnchorData,
} from "@atlasdraw/protocol";

import type { NormalizedZoomValue } from "@atlasdraw/excalidraw/types";

import { useCollab } from "../hooks/useCollab";

import { useCommentFocus } from "../state/commentFocus";
import { useCommentMode } from "../state/commentMode";
import {
  setAnchorMode,
  setPendingAnchor,
  usePendingAnchor,
} from "../state/comments-anchor-picker";
import {
  useLayerRegistryStore,
  type RasterLayerEntry,
} from "../state/layerRegistry";

import styles from "../styles/CommentAnchorsOverlay.module.css";

import { useAnnounce } from "./AriaAnnouncer";
import { CommentAnchor } from "./CommentAnchor";
import { CommentDraftBubble } from "./CommentDraftBubble";

import type { Comment } from "../state/comments";
import type maplibregl from "maplibre-gl";

// ExcalidrawImperativeAPI is not re-exported from @atlasdraw/excalidraw in
// v0.18 (see .claude/rules/excalidraw-api.md). We type-erase here — the
// methods we touch (onChange, getSceneElements, getAppState) are stable in
// production but pre-Phase-6 unit-test mocks may omit `onChange`; we guard
// at call sites for that.
type ExcalidrawAPIShape = {
  onChange?: (
    cb: (elements: unknown, appState: unknown) => void,
  ) => (() => void) | undefined | void;
  getSceneElements: () => ReadonlyArray<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  getAppState: () => unknown;
};

/** The slice of Excalidraw app state both projections need. */
type AppStateShape = {
  zoom: { value: NormalizedZoomValue };
  offsetLeft: number;
  offsetTop: number;
  scrollX: number;
  scrollY: number;
};

export interface CommentAnchorsOverlayProps {
  map: maplibregl.Map | null;
  excalidrawAPI: ExcalidrawAPIShape | null;
}

interface ProjectedAnchor {
  comment: Comment;
  screenX: number;
  screenY: number;
}

/** What a pick click landed on — drives the draft's Follow/Pin toggle. */
export type DraftHitTarget = { kind: "element" | "raster" } | null;

// Ray-casting point-in-polygon test on projected (screen) coordinates. Used by
// the click-intercept to hit-test raster layers, whose corners are projected
// to screen space with MapLibre's `map.project` before testing. (Same routine
// as MapEditor's layer-pick handler.)
function pointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const yiAbove = yi > point.y;
    const yjAbove = yj > point.y;
    if (
      yiAbove !== yjAbove &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function CommentAnchorsOverlay(
  props: CommentAnchorsOverlayProps,
): React.JSX.Element | null {
  const { map, excalidrawAPI } = props;
  const { commentsLayer } = useCollab();
  const { anchor: pendingAnchor } = usePendingAnchor();
  const commentMode = useCommentMode();
  // A canvas-search hit asks for one comment by id; the anchor that owns it
  // opens itself. Everyone else gets `undefined` and is untouched.
  const commentFocus = useCommentFocus();

  // Snapshot of comments (re-renders on Yjs change).
  const [comments, setComments] = useState<ReadonlyArray<Comment>>(
    () => commentsLayer?.comments ?? [],
  );

  useEffect(() => {
    if (!commentsLayer) {
      setComments([]);
      return;
    }
    setComments(commentsLayer.comments);
    return commentsLayer.subscribe(setComments);
  }, [commentsLayer]);

  // Phase 6 A14b — aria-live announcements for newly-arrived comments. The
  // CommentsLayer's sync-window guard suppresses the replay storm; this
  // overlay just routes the addition events into the announcer.
  const announce = useAnnounce();
  useEffect(() => {
    if (!commentsLayer) {
      return;
    }
    return commentsLayer.subscribeAdditions((c) => {
      announce(`New comment from ${c.authorName}`);
    });
  }, [commentsLayer, announce]);

  // Map point of the click that armed the current draft. The draft's
  // Follow/Pin toggle can pin to the map even when the click landed on an
  // element or raster, so the overlay keeps the click's lng/lat alongside
  // the (annotation-shaped) pendingAnchor.
  const [draftLngLat, setDraftLngLat] = useState<{
    lng: number;
    lat: number;
  } | null>(null);

  // Reprojection trigger: bump a tick when the map moves or the Excalidraw
  // scroll/zoom changes. We then recompute screen positions inline.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!map) {
      return;
    }
    const bump = (): void => setTick((t) => t + 1);
    map.on("move", bump);
    map.on("zoom", bump);
    return () => {
      map.off("move", bump);
      map.off("zoom", bump);
    };
  }, [map]);

  useEffect(() => {
    if (!excalidrawAPI || typeof excalidrawAPI.onChange !== "function") {
      return;
    }
    const unsubscribe = excalidrawAPI.onChange(() => setTick((t) => t + 1));
    return () => {
      // ExcalidrawImperativeAPI.onChange returns an UnsubscribeCallback in
      // v0.18 (see .claude/rules/excalidraw-api.md). Guard for the function
      // case; older mocks may return void.
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [excalidrawAPI]);

  // ---- Click-intercept hit-test cascade --------------------------------
  // Viewport (client) coords → scene coords, then a bounding-box probe over
  // every element. Elements are stored back-to-front, so iterate in reverse
  // and let the topmost match win. Simple AABB is v1's rotation tolerance.
  const hitTestElement = (clientX: number, clientY: number): string | null => {
    if (!excalidrawAPI) {
      return null;
    }
    const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
      { clientX, clientY },
      excalidrawAPI.getAppState() as AppStateShape,
    );
    const elements = excalidrawAPI.getSceneElements();
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i]!;
      const x0 = Math.min(el.x, el.x + el.width);
      const x1 = Math.max(el.x, el.x + el.width);
      const y0 = Math.min(el.y, el.y + el.height);
      const y1 = Math.max(el.y, el.y + el.height);
      if (sceneX >= x0 && sceneX <= x1 && sceneY >= y0 && sceneY <= y1) {
        return el.id;
      }
    }
    return null;
  };

  // Screen (map-canvas) coords → point-in-polygon over every raster's
  // projected corners.
  const hitTestRaster = (x: number, y: number): string | null => {
    if (!map) {
      return null;
    }
    const rasters = useLayerRegistryStore
      .getState()
      .entries.filter((e): e is RasterLayerEntry => e.kind === "raster");
    for (const entry of rasters) {
      const screenCorners = entry.corners.map((c) => map.project(c));
      if (pointInPolygon({ x, y }, screenCorners)) {
        return entry.id;
      }
    }
    return null;
  };

  const handleInterceptClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!map) {
      return;
    }
    // The intercept div and the map canvas share an origin (the overlay is
    // inset:0 over the map), so the click's position within the div is the
    // pixel space map.unproject / map.project speak in.
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lngLat = map.unproject([x, y]);
    const lngLatRecord = { lng: lngLat.lng, lat: lngLat.lat };

    // Cascade: Excalidraw element → raster layer → bare map point.
    const elementId = hitTestElement(e.clientX, e.clientY);
    if (elementId) {
      setDraftLngLat(lngLatRecord);
      setPendingAnchor({
        kind: "annotation",
        source: "element",
        elementId,
      });
      return;
    }
    const rasterId = hitTestRaster(x, y);
    if (rasterId) {
      setDraftLngLat(lngLatRecord);
      setPendingAnchor({ kind: "annotation", source: "raster", rasterId });
      return;
    }
    setDraftLngLat(lngLatRecord);
    setPendingAnchor({ kind: "map", lng: lngLat.lng, lat: lngLat.lat });
  };

  // The draft bubble is the mode's composer, so the overlay can no longer
  // bail purely on "no comments yet" — placing the FIRST thread happens in
  // exactly that state, and the click-intercept div must stay up to catch the
  // pick. It still bails when there is no session, because then there is
  // nowhere to write and nothing to project.
  const draftVisible = commentMode && pendingAnchor != null;
  if (
    !commentsLayer ||
    (comments.length === 0 && !draftVisible && !commentMode)
  ) {
    return null;
  }

  // `tick` reads as a dep so the closures below re-run on each bump.
  void tick;

  /**
   * Anchor → overlay-container pixels. Returns null when the anchor cannot be
   * placed right now (no map, or an element anchor whose element is gone).
   * Shared by the placed threads and the draft so both land on the same pixel.
   */
  const project = (
    rawAnchor: CommentAnchorData,
  ): { screenX: number; screenY: number } | null => {
    const anchor = normalizeAnchor(rawAnchor);
    if (anchor.kind === "map") {
      if (!map) {
        return null;
      }
      const p = map.project([anchor.lng, anchor.lat]);
      return { screenX: p.x, screenY: p.y };
    }
    if (anchor.kind === "annotation" && anchor.source === "raster") {
      if (!map) {
        return null;
      }
      const entry = useLayerRegistryStore
        .getState()
        .entries.find(
          (e): e is RasterLayerEntry =>
            e.kind === "raster" && e.id === anchor.rasterId,
        );
      if (!entry) {
        return null;
      }
      // Raster centroid — corners are [lng, lat] top-left → bottom-left.
      let lng = 0;
      let lat = 0;
      for (const [cornerLng, cornerLat] of entry.corners) {
        lng += cornerLng;
        lat += cornerLat;
      }
      const p = map.project([
        lng / entry.corners.length,
        lat / entry.corners.length,
      ]);
      return { screenX: p.x, screenY: p.y };
    }
    // annotation/source === "element" — normalizeAnchor already rewrote v1
    // "element" anchors into this canonical shape.
    if (!excalidrawAPI) {
      return null;
    }
    const el = excalidrawAPI
      .getSceneElements()
      .find((e: { id: string }) => e.id === anchor.elementId);
    if (!el) {
      return null;
    }
    // Element top-right corner — using Excalidraw element shape: x,y is
    // top-left scene-coords; width/height are scene units.
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: el.x + el.width, sceneY: el.y },
      excalidrawAPI.getAppState() as AppStateShape,
    );
    return { screenX: x, screenY: y };
  };

  const projected: ProjectedAnchor[] = [];
  for (const c of comments) {
    if (c.resolved) {
      // Resolved comments are filtered from the panel by default; keep them
      // out of the canvas overlay too so the map stays clean.
      continue;
    }
    const p = project(c.anchor);
    if (p) {
      projected.push({ comment: c, ...p });
    }
  }

  const authorId = commentsLayer
    ? `client-${commentsLayer.doc.clientID}`
    : "anonymous";

  const draftPoint =
    draftVisible && pendingAnchor ? project(pendingAnchor) : null;

  // What the current pick click landed on. Derives from the pending anchor
  // itself — annotation form means a target was hit, map form means bare map.
  const pendingNormalized = pendingAnchor
    ? normalizeAnchor(pendingAnchor)
    : null;
  const draftHitTarget: DraftHitTarget =
    pendingNormalized && pendingNormalized.kind === "annotation"
      ? { kind: pendingNormalized.source }
      : null;

  return (
    <div className={styles.overlay} data-testid="comment-anchors-overlay">
      {commentMode && !pendingAnchor && map && (
        <div
          className={styles.clickInterceptor}
          onClick={handleInterceptClick}
          data-testid="comment-click-intercept"
        />
      )}
      {projected.map((p) => (
        <CommentAnchor
          key={p.comment.id}
          comment={p.comment}
          screenX={p.screenX}
          screenY={p.screenY}
          isOwn={p.comment.authorId === authorId}
          onResolve={(id) => commentsLayer.resolve(id)}
          onEdit={(id, newText) => commentsLayer.editComment(id, newText)}
          focusNonce={
            commentFocus?.commentId === p.comment.id
              ? commentFocus.nonce
              : undefined
          }
        />
      ))}
      {draftPoint && pendingAnchor && (
        <CommentDraftBubble
          screenX={draftPoint.screenX}
          screenY={draftPoint.screenY}
          hitTarget={draftHitTarget}
          canSubmit={!!commentsLayer}
          onSubmit={(text, followMode) => {
            // The Follow/Pin toggle decides the final anchor shape. Follow
            // keeps the annotation anchor the click produced; Pin drops the
            // geographic point recorded at click time (the pendingAnchor only
            // holds the annotation form when the click hit a target).
            let anchor: CommentAnchorData;
            if (
              followMode &&
              pendingAnchor &&
              pendingAnchor.kind === "annotation"
            ) {
              anchor = pendingAnchor;
            } else if (pendingAnchor && pendingAnchor.kind === "map") {
              anchor = pendingAnchor;
            } else if (draftLngLat) {
              anchor = { kind: "map", ...draftLngLat };
            } else {
              return;
            }
            commentsLayer.addComment({
              text,
              anchor,
              authorId,
              authorName: "You",
            });
            // Re-arm rather than clear: comment mode stays on, so the next
            // click starts the next thread. `setAnchorMode` bumps
            // PickerState.arm and nulls the anchor, which is what makes the
            // click-intercept div re-appear.
            setAnchorMode("any");
          }}
          onCancel={() => setAnchorMode("any")}
        />
      )}
    </div>
  );
}
