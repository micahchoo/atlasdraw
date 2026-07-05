/**
 * useToolState — subscribes to Excalidraw active tool changes and derives
 * the pointer-events gate for the Flow B decision node.
 *
 * Subscription mechanism: ExcalidrawImperativeAPI.onChange(callback) returns
 * an UnsubscribeCallback — direct API subscription, no prop drilling required.
 * The callback fires on every scene mutation; we bail early when activeTool.type
 * hasn't changed to avoid unnecessary re-renders during drawing drags.
 *
 * Initial state is seeded immediately from api.getAppState() so downstream
 * consumers never observe a spurious null/false on the first render after
 * the API becomes available.
 *
 * @see classifyTool in @atlasdraw/tools for the isDrawingMode gate definition.
 * @see MapEditor.tsx — consumes isDrawingMode to toggle .excalidrawLayerActive.
 */

import { useEffect, useState } from "react";

import { classifyTool } from "@atlasdraw/tools";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolState {
  /** The currently active Excalidraw tool, or null before first change event. */
  activeTool: { type: string } | null;
  /**
   * True when the active tool requires Excalidraw to capture pointer events
   * (i.e. any tool other than "hand" or "selection").
   * Defaults to false (map-interactive) until the API delivers tool state.
   */
  isDrawingMode: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribes to Excalidraw tool state changes via the imperative API's
 * onChange mechanism. Derives isDrawingMode for the pointer-events gate.
 *
 * @param api - ExcalidrawImperativeAPI, null until Excalidraw has mounted.
 */
export function useToolState(api: ExcalidrawImperativeAPI | null): ToolState {
  const [state, setState] = useState<ToolState>({
    activeTool: null,
    isDrawingMode: false,
  });

  useEffect(() => {
    if (!api) {
      return;
    }

    // Seed initial state immediately — avoids a null activeTool on the first
    // render after the API becomes available. getAppState() is synchronous.
    const initialAppState = api.getAppState();
    const initialType = initialAppState.activeTool.type;
    setState({
      activeTool: { type: initialType },
      isDrawingMode: classifyTool(initialType),
    });

    // Subscribe to all subsequent scene changes.
    const unsubscribe = api.onChange((_elements, appState, _files) => {
      const nextType = appState.activeTool.type;
      setState((prev) => {
        // Bail early — onChange fires on every pointer move during a drag.
        // Only update when the tool type actually changes.
        if (prev.activeTool?.type === nextType) {
          return prev;
        }
        return {
          activeTool: { type: nextType },
          isDrawingMode: classifyTool(nextType),
        };
      });
    });

    return () => {
      unsubscribe();
    };
  }, [api]);

  return state;
}
