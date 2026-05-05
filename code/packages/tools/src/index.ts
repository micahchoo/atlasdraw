// @atlasdraw/tools — public surface.
export * from "./types.js";
export { classifyTool } from "./classifyTool.js";
export { PinTool } from "./PinTool.js"; // Phase 1 Wave 3b Task 14
// Phase 2 Wave 1b additions:
export { PolygonTool } from "./PolygonTool.js";   // T03
export { PolylineTool } from "./PolylineTool.js"; // T04
export { FreehandTool } from "./FreehandTool.js"; // T05
export { TextLabelTool } from "./TextLabelTool.js"; // T06
export { ArrowTool } from "./ArrowTool.js";       // T07
export { RectangleTool } from "./RectangleTool.js"; // T08
export { CircleTool } from "./CircleTool.js";     // T09
// Phase 2 Wave 2b additions:
export {
  annotationToFeatureCollection,
  UnsupportedConvertElementError,
  type ConvertibleElement,
} from "./convert.js"; // T14
