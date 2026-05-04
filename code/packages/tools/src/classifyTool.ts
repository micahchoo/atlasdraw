/**
 * classifyTool — pure gate function for the pointer-events toggle.
 *
 * Returns true (drawing mode) for any tool type that requires Excalidraw to
 * capture pointer events. Returns false only for "hand", which is the explicit
 * map-pan tool.
 *
 * Phase 1 contract (per plan Task 13 + atlasdraw-dd91 resolution):
 *   isDrawingMode = toolType !== "hand"
 *
 * Selection becomes drawing-mode so users can click geo-elements (pins,
 * rectangles) once Wave 3b lands. The "hand" tool remains pass-through for
 * map pan/zoom. UX implication: keyboard 'h' or toolbar hand toggle is the
 * way to pan the map; selection no longer falls through. Revisit in Phase 4
 * toolbar work if dual-purpose selection is required.
 *
 * @param toolType - The `activeTool.type` string from Excalidraw AppState.
 * @returns true if the Excalidraw layer should capture pointer events.
 */
export function classifyTool(toolType: string): boolean {
  return toolType !== "hand";
}
