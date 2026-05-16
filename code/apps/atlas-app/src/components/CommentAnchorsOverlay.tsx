// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — CommentAnchorsOverlay.
//
// Iterates the live CommentsLayer.comments list and renders one
// <CommentAnchor /> per row, projected to screen-space coordinates:
//
//   - map anchors:     map.project([lng, lat]) → screen pixels; re-projected
//                      on every map move + zoomend.
//   - element anchors: sceneCoordsToViewportCoords (from @atlasdraw/common —
//                      verified at code/packages/common/src/utils.ts:439) on
//                      the element's bounding-box top-right; re-projected
//                      on Excalidraw scrollX/scrollY/zoom changes.
//
// Mounted by MapEditor as a sibling of the Excalidraw canvas. Pointer events
// are scoped to the rendered anchors themselves (z-index 10 per
// atlasdraw-ui-conventions) — the surrounding container is pointer-events:none.
//
// Plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A3
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React, { useEffect, useState } from "react";
import type maplibregl from "maplibre-gl";
import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { useCollab } from "../hooks/useCollab";
import type { Comment } from "../state/comments";
import { useAnnounce } from "./AriaAnnouncer";
import { CommentAnchor } from "./CommentAnchor";
import {
  setPendingAnchor,
  usePendingAnchor,
} from "../state/comments-anchor-picker";
import styles from "../styles/CommentAnchorsOverlay.module.css";

// ExcalidrawImperativeAPI is not re-exported from @excalidraw/excalidraw in
// v0.18 (see .claude/rules/excalidraw-api.md). We type-erase here — the
// methods we touch (onChange, getSceneElements, getAppState) are stable in
// production but pre-Phase-6 unit-test mocks may omit `onChange`; we guard
// at call sites for that.
type ExcalidrawAPIShape = {
  onChange?: (
    cb: (elements: unknown, appState: unknown) => void,
  ) => (() => void) | undefined | void;
  getSceneElements: () => ReadonlyArray<{ id: string }>;
  getAppState: () => unknown;
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

export function CommentAnchorsOverlay(
  props: CommentAnchorsOverlayProps,
): React.JSX.Element | null {
  const { map, excalidrawAPI } = props;
  const { commentsLayer } = useCollab();
  const { mode: pickerMode } = usePendingAnchor();

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
    if (!commentsLayer) return;
    return commentsLayer.subscribeAdditions((c) => {
      announce(`New comment from ${c.authorName}`);
    });
  }, [commentsLayer, announce]);

  // ---- Anchor picker: map mode ------------------------------------------
  // When the panel signals "I want a map anchor", capture the next map click
  // as a {lng, lat} pair and publish it as the pendingAnchor.
  useEffect(() => {
    if (!map || pickerMode !== "map") return;
    const handler = (
      e: maplibregl.MapMouseEvent & { lngLat: { lng: number; lat: number } },
    ): void => {
      setPendingAnchor({
        kind: "map",
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
      });
    };
    map.once("click", handler);
    return () => {
      // map.off accepts the same listener; once registers a one-shot,
      // so removing covers the unmount-before-click case.
      map.off("click", handler);
    };
  }, [map, pickerMode]);

  // ---- Anchor picker: element mode --------------------------------------
  // When the panel signals "I want an element anchor", capture the next
  // single-element Excalidraw selection as its elementId.
  useEffect(() => {
    if (!excalidrawAPI || pickerMode !== "element") return;
    if (typeof excalidrawAPI.onChange !== "function") return;
    let done = false;
    const unsub = excalidrawAPI.onChange((_elements: unknown, appState: unknown) => {
      if (done) return;
      const a = appState as unknown as {
        selectedElementIds?: Record<string, boolean>;
      };
      const ids = Object.keys(a.selectedElementIds ?? {});
      if (ids.length === 1) {
        done = true;
        setPendingAnchor({ kind: "element", elementId: ids[0]! });
      }
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [excalidrawAPI, pickerMode]);

  // Reprojection trigger: bump a tick when the map moves or the Excalidraw
  // scroll/zoom changes. We then recompute screen positions inline.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!map) return;
    const bump = (): void => setTick((t) => t + 1);
    map.on("move", bump);
    map.on("zoom", bump);
    return () => {
      map.off("move", bump);
      map.off("zoom", bump);
    };
  }, [map]);

  useEffect(() => {
    if (!excalidrawAPI || typeof excalidrawAPI.onChange !== "function") return;
    const unsubscribe = excalidrawAPI.onChange(() => setTick((t) => t + 1));
    return () => {
      // ExcalidrawImperativeAPI.onChange returns an UnsubscribeCallback in
      // v0.18 (see .claude/rules/excalidraw-api.md). Guard for the function
      // case; older mocks may return void.
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [excalidrawAPI]);

  if (!commentsLayer || comments.length === 0) return null;

  const projected: ProjectedAnchor[] = [];
  // `tick` reads as a dep so the closure here re-runs on each bump.
  void tick;

  for (const c of comments) {
    if (c.resolved) {
      // Resolved comments are filtered from the panel by default; keep them
      // out of the canvas overlay too so the map stays clean.
      continue;
    }
    if (c.anchor.kind === "map") {
      if (!map) continue;
      const p = map.project([c.anchor.lng, c.anchor.lat]);
      projected.push({ comment: c, screenX: p.x, screenY: p.y });
    } else if (c.anchor.kind === "element") {
      if (!excalidrawAPI) continue;
      const elementId = c.anchor.elementId;
      const elements = excalidrawAPI.getSceneElements();
      const el = elements.find((e: { id: string }) => e.id === elementId);
      if (!el) continue;
      // Element top-right corner — using Excalidraw element shape: x,y is
      // top-left scene-coords; width/height are scene units.
      const e = el as unknown as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      const appState = excalidrawAPI.getAppState();
      const { x, y } = sceneCoordsToViewportCoords(
        { sceneX: e.x + e.width, sceneY: e.y },
        // Cast around v0.18's branded NormalizedZoomValue — at runtime this
        // is a plain number. See .claude/rules/excalidraw-api.md.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        appState as any,
      );
      projected.push({ comment: c, screenX: x, screenY: y });
    }
  }

  return (
    <div className={styles.overlay} data-testid="comment-anchors-overlay">
      {projected.map((p) => (
        <CommentAnchor
          key={p.comment.id}
          comment={p.comment}
          screenX={p.screenX}
          screenY={p.screenY}
          onResolve={(id) => commentsLayer.resolve(id)}
        />
      ))}
    </div>
  );
}
