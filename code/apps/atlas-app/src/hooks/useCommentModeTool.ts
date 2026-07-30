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
//     is NOT reachable from inside the mode — Excalidraw's `setActiveTool`
//     clears `selectedElementIds` for every non-selection tool (App.tsx:5769),
//     so the swap to `hand` drops whatever was selected on the way in, and
//     `hand` cannot make a new selection. The element picker is armed for the
//     Threads list's Element toggle, which sets its own mode. Making the two
//     anchor kinds properly co-available is a pointer-routing decision, not a
//     mode one, and is deliberately still open.
//
// EXIT — three ways out, and they do not restore the same things.
//   Escape / the rail toggle / `c`: the mode is over and nothing else changed,
//   so put back exactly what was borrowed — the Excalidraw tool AND the atlas
//   tool. That is the "modes are borrowed, not taken" contract.
//
//   Picking a real tool (`r`, the toolbar, the ⌘K palette): the pick IS the
//   exit, and there is nothing to restore because the user just said what they
//   want. Without this branch the mode outlived its own usefulness — the
//   pointer gate stops routing clicks to MapLibre the moment the tool is not
//   `hand`, so the anchor picker can never fire, while the crosshair, the hint
//   and `aria-pressed` all still claim the mode is live. A mode with a visible
//   state that is a LIE is worse than one with no visible state at all. The
//   alternative — visibly suspending — was rejected: it adds a third state that
//   all five surfaces in commentMode.ts's list have to render and explain, to
//   describe a situation the user leaves by doing the thing they already did.
//
//   Either way the picker is cleared, which drops a half-placed anchor and its
//   draft composer. That is also what stops the element picker from opening an
//   unbidden composer when the shape the user just drew gets auto-selected.
//
// Both previous-tool memories are refs rather than store state because nothing
// else reads them, and because they must survive only as long as the effect
// that owns the restore.

import { useCallback, useEffect, useRef } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { AtlasdrawTool } from "@atlasdraw/tools";

import { setCommentMode, useCommentMode } from "../state/commentMode";
import {
  clearAnchorPicker,
  setAnchorMode,
} from "../state/comments-anchor-picker";

export interface CommentModeToolParams {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** `activeAtlasTool` from useAtlasdrawTool — dropped on enter, put back on exit. */
  atlasTool: AtlasdrawTool | null;
  /** `setActiveAtlasTool` from useAtlasdrawTool. */
  setAtlasTool: (tool: AtlasdrawTool | null) => void;
}

/** The tool comment mode borrows. See the header for why it is not `selection`. */
export const COMMENT_MODE_TOOL = "hand" as const;

export function useCommentModeTool({
  excalidrawAPI,
  atlasTool,
  setAtlasTool,
}: CommentModeToolParams): void {
  const active = useCommentMode();
  const previousToolRef = useRef<string | null>(null);
  const previousAtlasToolRef = useRef<AtlasdrawTool | null>(null);

  // Mirrored into a ref instead of being a dependency of the effect below: as a
  // dependency it would tear the mode down and re-enter it every time the atlas
  // tool changed, which restores the borrowed tool in the middle of the mode.
  const atlasToolRef = useRef(atlasTool);
  useEffect(() => {
    atlasToolRef.current = atlasTool;
  }, [atlasTool]);

  /**
   * Picking a tool is the exit — for both toolbars, because "which toolbar was
   * it?" is not a distinction the user made.
   *
   * What differs is what the teardown should still put back. Dropping a memory
   * here is how this tells the teardown to leave that tool alone:
   *
   *   - an Excalidraw tool was picked → drop both. The editor already holds the
   *     tool the user asked for, and they did not ask for the old atlas tool.
   *   - an atlas tool was picked → drop only the atlas memory. The Excalidraw
   *     tool is still the borrowed `hand`, which was never anyone's choice, so
   *     the teardown restoring it is exactly right.
   */
  const exitBecauseToolPicked = useCallback((which: "excalidraw" | "atlas") => {
    previousAtlasToolRef.current = null;
    if (which === "excalidraw") {
      previousToolRef.current = null;
    }
    setCommentMode(false);
  }, []);

  // True from the moment the mode writes its own `setAtlasTool(null)` until that
  // null is visible in a render. Without it, entering the mode with Pin already
  // armed would exit immediately — the watcher below runs in the commit after
  // the entry effect, while `atlasTool` still holds the pre-entry value.
  const clearingAtlasToolRef = useRef(false);

  useEffect(() => {
    if (!active) {
      return;
    }

    const previous =
      excalidrawAPI?.getAppState()?.activeTool?.type ?? "selection";
    previousToolRef.current = previous;
    previousAtlasToolRef.current = atlasToolRef.current;

    clearingAtlasToolRef.current = true;
    setAtlasTool(null);
    if (previous !== COMMENT_MODE_TOOL) {
      excalidrawAPI?.setActiveTool({ type: COMMENT_MODE_TOOL });
    }
    setAnchorMode("any");

    // Subscribed AFTER the swap above, so the first state this can observe
    // already carries `hand`; anything else is the user (or an action) choosing
    // a tool, which ends the mode. `onChange` fires from Excalidraw's
    // componentDidUpdate with `this.state`, so the tool it reports is never
    // stale (App.tsx:3730).
    const unsubscribe =
      typeof excalidrawAPI?.onChange === "function"
        ? excalidrawAPI.onChange((_elements, appState) => {
            const next = appState?.activeTool?.type;
            if (!next || next === COMMENT_MODE_TOOL) {
              return;
            }
            exitBecauseToolPicked("excalidraw");
          })
        : undefined;

    return () => {
      unsubscribe?.();
      clearAnchorPicker();
      const restore = previousToolRef.current;
      const restoreAtlasTool = previousAtlasToolRef.current;
      previousToolRef.current = null;
      previousAtlasToolRef.current = null;
      if (restore && restore !== COMMENT_MODE_TOOL) {
        // `type` is Excalidraw's ToolType union; the value came out of
        // appState.activeTool.type so it is a member by construction.
        excalidrawAPI?.setActiveTool({
          type: restore,
        } as Parameters<ExcalidrawImperativeAPI["setActiveTool"]>[0]);
      }
      if (restoreAtlasTool) {
        setAtlasTool(restoreAtlasTool);
      }
    };
  }, [active, excalidrawAPI, setAtlasTool, exitBecauseToolPicked]);

  // The atlas toolbar gets the same exit-on-pick as Excalidraw's.
  //
  // The entry effect drops the atlas tool once, and `atlasTool` is deliberately
  // not one of its dependencies, so before this nothing noticed a tool being
  // re-armed mid-mode. An armed atlas tool puts MapEditor's `atlasToolOverlay`
  // over the plate and takes its pointer events, so the anchor picker can never
  // fire — while the crosshair, the on-plate hint and the rail's `aria-pressed`
  // all still claim the mode is live. Exactly the lie the Excalidraw branch
  // exists to prevent, and it was reachable: the Pin button stays mounted and
  // enabled during the mode.
  //
  // DECLARED AFTER the entry effect on purpose. React runs effects in
  // declaration order, so on the commit that turns the mode on, the entry effect
  // has already set the guard below before this one looks.
  useEffect(() => {
    if (!active || atlasTool === null) {
      clearingAtlasToolRef.current = false;
      return;
    }
    if (clearingAtlasToolRef.current) {
      return;
    }
    exitBecauseToolPicked("atlas");
  }, [active, atlasTool, exitBecauseToolPicked]);
}
