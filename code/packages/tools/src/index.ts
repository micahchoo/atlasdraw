// @atlasdraw/tools — public surface.
// T14

// ISSUES.md Direction 4 (headroom audit, verdict: pursue) — registerTool()/
// getTool()/listTools(). `ToolRegistry` (types.ts) was documented as "built
// up in apps/atlas-app from @atlasdraw/tools exports" but nothing anywhere
// ever actually constructed one — only PinTool was ever directly imported
// by name; the 7 other tools had no lookup-by-id path at all. The 8 tools
// above are unchanged (still directly importable by name); they're now
// ALSO self-registered here as a module-load side effect, so a caller that
// wants "the tool named X" without a compile-time import can get one.
//
// The generic registry factory is duplicated (not shared via
// @atlasdraw/common) for the same reason packages/basemap's
// BasemapRegistry.ts duplicates it: the root tsconfig.json's composite
// project graph explicitly excludes @atlasdraw/common from the atlas-owned
// package graph both basemap and tools belong to.
import { PinTool } from "./PinTool.js";
import { PolygonTool } from "./PolygonTool.js";
import { PolylineTool } from "./PolylineTool.js";
import { FreehandTool } from "./FreehandTool.js";
import { TextLabelTool } from "./TextLabelTool.js";
import { ArrowTool } from "./ArrowTool.js";
import { RectangleTool } from "./RectangleTool.js";
import { CircleTool } from "./CircleTool.js";

import type { AtlasdrawTool } from "./types.js";
export * from "./types.js";
export { classifyTool } from "./classifyTool.js";
export { PinTool } from "./PinTool.js"; // Phase 1 Wave 3b Task 14
// Phase 2 Wave 1b additions:
export { PolygonTool } from "./PolygonTool.js"; // T03
export { PolylineTool } from "./PolylineTool.js"; // T04
export { FreehandTool } from "./FreehandTool.js"; // T05
export { TextLabelTool } from "./TextLabelTool.js"; // T06
export { ArrowTool } from "./ArrowTool.js"; // T07
export { RectangleTool } from "./RectangleTool.js"; // T08
export { CircleTool } from "./CircleTool.js"; // T09
// Phase 2 Wave 2b additions:
export {
  annotationToFeatureCollection,
  UnsupportedConvertElementError,
  type ConvertibleElement,
} from "./convert.js";

interface Registry<T> {
  register(id: string, item: T): void;
  get(id: string): T | undefined;
  list(): readonly T[];
}

function createRegistry<T>(): Registry<T> {
  const items = new Map<string, T>();
  return {
    register(id, item) {
      if (items.has(id)) {
        throw new Error(`Registry: "${id}" is already registered`);
      }
      items.set(id, item);
    },
    get: (id) => items.get(id),
    list: () => Array.from(items.values()),
  };
}

const toolRegistry = createRegistry<AtlasdrawTool>();

/** Register a tool. Throws if `tool.id` is already registered. */
export function registerTool(tool: AtlasdrawTool): void {
  toolRegistry.register(tool.id, tool);
}

export function getTool(id: string): AtlasdrawTool | undefined {
  return toolRegistry.get(id);
}

/** All registered tools, in registration order. */
export function listTools(): readonly AtlasdrawTool[] {
  return toolRegistry.list();
}

for (const tool of [
  PinTool,
  PolygonTool,
  PolylineTool,
  FreehandTool,
  TextLabelTool,
  ArrowTool,
  RectangleTool,
  CircleTool,
] as const) {
  registerTool(tool);
}
