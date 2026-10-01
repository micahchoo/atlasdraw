/**
 * classifyTool — pure gate function for the pointer-events toggle.
 *
 * Returns true (drawing mode) for any tool type that requires Excalidraw to
 * capture pointer events. Returns false only for "hand", which is the explicit
 * map-pan tool.
 *
 * Contract:
 *   isDrawingMode = toolType !== "hand"
 *
 * Selection is drawing mode, so users can click drawn elements (pins,
 * rectangles), and a drag with the selection tool selects. Only the "hand"
 * tool passes the pointer through to the map. Space+drag, wheel and pinch
 * move the map with any tool (atlas-app's MapEditor).
 *
 * @param toolType - The `activeTool.type` string from Excalidraw AppState.
 * @returns true if the Excalidraw layer should capture pointer events.
 */
export function classifyTool(toolType: string): boolean {
  return toolType !== "hand";
}
