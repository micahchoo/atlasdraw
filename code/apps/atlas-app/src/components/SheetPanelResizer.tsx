// SPDX-License-Identifier: AGPL-3.0-only
//
// SheetPanelResizer — the drag handle on the sheet panel's LEFT edge.
//
// Why it lives app-side rather than inside the vendored `Sidebar`: the width it
// edits is the host's (persisted in `state/sheetPanel.ts`, published back into
// the editor as the `rightSidebarWidth` prop), and the panel's left edge is a
// position the host already knows — the plate's right edge minus the width.
// Putting the handle in the fork would mean a second controlled-value round
// trip for no new information. This mirrors `SheetRail`, which is likewise an
// app-side control over a fork surface.
//
// Z-index 10 (toolbar/banner band, see MapEditor.module.css's ladder). The
// sidebar's own `--zIndex-ui-library: 120` is private to `.excalidrawLayer`,
// which is `position: absolute; z-index: 1` and therefore a stacking context —
// so the sidebar resolves at 1 in the band this handle competes in, and 10 is
// enough to sit over its edge. Same reasoning as SheetRail's tooltip.
//
// Accessibility: a focusable `role="separator"` window splitter — the ARIA
// pattern for exactly this control. It carries an accessible name,
// `aria-valuenow/min/max` in px, and arrow-key resizing, so the panel width is
// fully settable without a pointer. Left = wider, because the panel grows
// leftward from the right edge and the handle IS its left edge.

import { useCallback, useEffect, useRef } from "react";

import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "@atlasdraw/common";

import styles from "../styles/SheetPanelResizer.module.css";

/** px per arrow press, and per Shift+arrow / PageUp-PageDown press. */
const STEP = 16;
const COARSE_STEP = 64;

interface SheetPanelResizerProps {
  /** Current panel width in px. */
  width: number;
  /** Commit a new width. The store clamps; callers need not. */
  onWidth: (width: number) => void;
  /** Back to the default width — double-click, and Enter/Space. */
  onReset: () => void;
}

export function SheetPanelResizer({
  width,
  onWidth,
  onReset,
}: SheetPanelResizerProps) {
  const ref = useRef<HTMLDivElement>(null);
  // rAF-coalesced drag: pointermove fires far more often than once a frame, and
  // every commit re-renders the editor AND resizes the MapLibre canvas
  // (MapCanvas's ResizeObserver → map.resize()). One commit per frame is the
  // budget; the last position within a frame is the only one that matters.
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  // Drags outliving the component (panel closed mid-drag) would otherwise leave
  // a queued frame writing to an unmounted store subscriber.
  useEffect(() => cancelFrame, [cancelFrame]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = ref.current;
    // `> 0` rather than `!== 0`: a secondary button is out, but a synthesized
    // event with no `button` at all (jsdom, some assistive tech) is a primary
    // press and must not be silently dropped.
    if (!handle || event.button > 0) {
      return;
    }
    // The panel's right edge is its container's right edge; width is the
    // distance from there to the pointer. Read from the offset parent rather
    // than from `width` + a delta so a dropped pointermove can't accumulate
    // drift over a long drag.
    const containerRight =
      handle.offsetParent?.getBoundingClientRect().right ??
      handle.getBoundingClientRect().right;

    handle.setPointerCapture(event.pointerId);
    event.preventDefault();

    const commit = (clientX: number) => {
      pendingRef.current = containerRight - clientX;
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        if (pendingRef.current !== null) {
          onWidth(pendingRef.current);
          pendingRef.current = null;
        }
      });
    };

    const onMove = (moveEvent: PointerEvent) => commit(moveEvent.clientX);
    const onUp = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      // Land the final position synchronously — a pending rAF would otherwise
      // be the last word, and on pointercancel it may never run.
      cancelFrame();
      onWidth(containerRight - upEvent.clientX);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      // The panel grows leftward, so Left widens. Matches what the pointer
      // does with the same motion.
      case "ArrowLeft":
        onWidth(width + (event.shiftKey ? COARSE_STEP : STEP));
        break;
      case "ArrowRight":
        onWidth(width - (event.shiftKey ? COARSE_STEP : STEP));
        break;
      case "PageUp":
        onWidth(width + COARSE_STEP);
        break;
      case "PageDown":
        onWidth(width - COARSE_STEP);
        break;
      // Splitter convention: Home/End are the ends of the travel.
      case "Home":
        onWidth(RIGHT_SIDEBAR_MIN_WIDTH);
        break;
      case "End":
        onWidth(RIGHT_SIDEBAR_MAX_WIDTH);
        break;
      case "Enter":
      case " ":
        onReset();
        break;
      default:
        // Everything else — Escape, Tab — belongs to the browser and to the
        // editor's own handlers.
        return;
    }
    event.preventDefault();
    // The editor listens for keydown on the document (handleKeyboardGlobally
    // is off, but Sidebar's Escape handler and the tool shortcuts are not),
    // and an arrow key here must not also nudge a selected element.
    event.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className={styles.handle}
      style={{ right: `${width}px` }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sheet panel"
      aria-valuenow={width}
      aria-valuemin={RIGHT_SIDEBAR_MIN_WIDTH}
      aria-valuemax={RIGHT_SIDEBAR_MAX_WIDTH}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      title={`Drag to resize · double-click for ${RIGHT_SIDEBAR_DEFAULT_WIDTH}px`}
      data-testid="sheet-panel-resizer"
    >
      <span className={styles.grip} aria-hidden="true" />
    </div>
  );
}
