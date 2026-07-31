// SPDX-License-Identifier: AGPL-3.0-only
// Step 5 — the side of comment mode that touches the editor.
//
// `state/commentMode.ts` holds the boolean; this hook is everything that has
// to happen at the two edges of it. MapEditor mounts it exactly once.
//
// ENTER
//   * drop any one-shot atlas tool (Pin) — two pointer consumers on the same
//     click is how you get a pin AND a comment from one gesture.
//   * arm the anchor picker in "any". CommentAnchorsOverlay gates its own
//     click interception on `commentMode && !pendingAnchor`, so the picker
//     mode is the overlay's signal that a fresh thread is expected; the
//     overlay re-arms it (submit / cancel) while the mode stays on.
//
// The Excalidraw tool is NOT borrowed anymore. Comment mode used to swap the
// editor to `hand` so map clicks reached MapLibre; the overlay now intercepts
// clicks itself (see CommentAnchorsOverlay), so the tool stays exactly as the
// user left it — and a tool pick is no longer an exit. Escape and the rail
// toggle are the only ways out.
//
// EXIT — the mode is over and nothing else changed, so put back what was
// borrowed: the atlas tool. There is no Excalidraw tool to restore because
// none was ever taken. The picker is cleared, which drops a half-placed
// anchor and its draft composer.
//
// The pre-entry atlas tool is remembered in a ref rather than store state
// because nothing else reads it, and because it must survive only as long as
// the effect that owns the restore. `atlasTool` itself is deliberately not an
// effect dependency: the entry effect drops it once, and letting the change
// re-run the effect would restore the borrowed tool in the middle of the mode
// every time the user re-armed it.

import { useEffect, useRef } from "react";

import type { AtlasdrawTool } from "@atlasdraw/tools";

import { useCommentMode } from "../state/commentMode";
import {
  clearAnchorPicker,
  setAnchorMode,
} from "../state/comments-anchor-picker";

export interface CommentModeToolParams {
  /** `activeAtlasTool` from useAtlasdrawTool — dropped on enter, put back on exit. */
  atlasTool: AtlasdrawTool | null;
  /** `setActiveAtlasTool` from useAtlasdrawTool. */
  setAtlasTool: (tool: AtlasdrawTool | null) => void;
}

export function useCommentModeTool({
  atlasTool,
  setAtlasTool,
}: CommentModeToolParams): void {
  const active = useCommentMode();

  // Mirrored into a ref instead of being a dependency of the effect below: as a
  // dependency it would tear the mode down and re-enter it every time the atlas
  // tool changed, which restores the borrowed tool in the middle of the mode.
  const atlasToolRef = useRef(atlasTool);
  useEffect(() => {
    atlasToolRef.current = atlasTool;
  }, [atlasTool]);

  // The pre-entry tool, read once at entry. Kept in a ref so the cleanup
  // restores exactly what was dropped, not whatever got armed mid-mode.
  const previousAtlasToolRef = useRef<AtlasdrawTool | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    previousAtlasToolRef.current = atlasToolRef.current;
    setAtlasTool(null);
    setAnchorMode("any");

    return () => {
      clearAnchorPicker();
      const restoreAtlasTool = previousAtlasToolRef.current;
      previousAtlasToolRef.current = null;
      if (restoreAtlasTool) {
        setAtlasTool(restoreAtlasTool);
      }
    };
  }, [active, setAtlasTool]);
}
