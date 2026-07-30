// SPDX-License-Identifier: AGPL-3.0-only
// Step 5 — the side of comment mode that touches the editor.
//
// `state/commentMode.ts` holds the boolean; this hook is everything that has
// to happen at the two edges of it. MapEditor mounts it exactly once.
//
// ENTER
//   * remember the active Excalidraw tool, then switch to `hand`.
//     Why `hand` and not `selection`: the Flow-B pointer-events gate
//     (`classifyTool` in @atlasdraw/tools, consumed by MapEditor as
//     `isDrawingMode`) routes clicks to MapLibre only for `hand`. `selection`
//     classifies as a drawing tool and Excalidraw's canvas swallows the click,
//     so a map-anchored thread would be unplaceable. Dropping a pin on the map
//     is the mode's whole point, so `hand` is the tool the mode implies.
//   * drop any one-shot atlas tool (Pin) — two pointer consumers on the same
//     click is how you get a pin AND a comment from one gesture.
//   * arm the anchor picker in "any": the map-click picker and the
//     element-selection picker both listen, first one wins. Element anchoring
//     is still reachable because a selection made before entering the mode, or
//     from the Threads list's Element toggle, still resolves.
//
// EXIT
//   * clear the picker (drops a half-placed anchor and its draft composer)
//   * put the previous tool back. This is the "modes are borrowed, not taken"
//     contract — Escape leaves you exactly where you were.
//
// The previous-tool memory is a ref rather than store state because nothing
// else reads it, and because it must survive only as long as the effect that
// owns the restore.

import { useEffect, useRef } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { useCommentMode } from "../state/commentMode";
import {
  clearAnchorPicker,
  setAnchorMode,
} from "../state/comments-anchor-picker";

export interface CommentModeToolParams {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** `setActiveAtlasTool` from useAtlasdrawTool — called with null on enter. */
  clearAtlasTool: () => void;
}

/** The tool comment mode borrows. See the header for why it is not `selection`. */
export const COMMENT_MODE_TOOL = "hand" as const;

export function useCommentModeTool({
  excalidrawAPI,
  clearAtlasTool,
}: CommentModeToolParams): void {
  const active = useCommentMode();
  const previousToolRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    const previous =
      excalidrawAPI?.getAppState()?.activeTool?.type ?? "selection";
    previousToolRef.current = previous;

    clearAtlasTool();
    if (previous !== COMMENT_MODE_TOOL) {
      excalidrawAPI?.setActiveTool({ type: COMMENT_MODE_TOOL });
    }
    setAnchorMode("any");

    return () => {
      clearAnchorPicker();
      const restore = previousToolRef.current;
      previousToolRef.current = null;
      if (restore && restore !== COMMENT_MODE_TOOL) {
        // `type` is Excalidraw's ToolType union; the value came out of
        // appState.activeTool.type so it is a member by construction.
        excalidrawAPI?.setActiveTool({
          type: restore,
        } as Parameters<ExcalidrawImperativeAPI["setActiveTool"]>[0]);
      }
    };
  }, [active, excalidrawAPI, clearAtlasTool]);
}
