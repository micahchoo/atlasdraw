// @atlasdraw/tools — public surface.
// T14

// FU-2 (2026-07-31) — the seven geo-tools this package used to export were
// deleted. PolygonTool, PolylineTool, FreehandTool, TextLabelTool, ArrowTool,
// RectangleTool and CircleTool (T03-T09) had zero runtime consumers: outside
// this package every reference to them was a comment in seedToElement.ts
// naming which T-task a branch mirrors. They were never the drawing path.
//
// Phase 2 Wave 4 T18 is when that happened. `useGeoAnchor` auto-stamps
// `customData.geo` on elements from the NATIVE Excalidraw toolbar, dispatching
// by element type (useGeoAnchor.ts:12-18, wired at MapEditor.tsx:598); T18
// widened it from bbox-only to all native tools. From that point the native
// toolbar produced geo-anchored shapes and these seven produced nothing.
//
// The one argument for keeping them was that a native bbox is screen-space and
// a geo polygon is not, so they were held as the correct-under-rotation path.
// FU-14's D6 retired it: drawing is blocked unless bearing is 0, and at bearing
// 0 the two coincide. See .agents/docs/SHEET_PANEL_FOLLOWUPS.md FU-2.
//
// PinTool stays — it is genuinely activated (MapEditor.tsx:932, :1253) — as do
// `classifyTool`, the `AtlasdrawTool` type, and `convert`.
//
// ISSUES.md Direction 4 (headroom audit, verdict: pursue) — registerTool()/
// getTool()/listTools(). `ToolRegistry` (types.ts) was documented as "built
// up in apps/atlas-app from @atlasdraw/tools exports" but nothing anywhere
// ever actually constructed one. The registry stays with one built-in in it:
// it is the lookup-by-id path for tools registered from outside this package,
// which is what it was built for and is unaffected by how many ship here.
//
// The generic registry factory is duplicated (not shared via
// @atlasdraw/common) for the same reason packages/basemap's
// BasemapRegistry.ts duplicates it: the root tsconfig.json's composite
// project graph explicitly excludes @atlasdraw/common from the atlas-owned
// package graph both basemap and tools belong to.
import { PinTool } from "./PinTool.js";

import type { AtlasdrawTool } from "./types.js";
export * from "./types.js";
export { classifyTool } from "./classifyTool.js";
export { PinTool } from "./PinTool.js"; // Phase 1 Wave 3b Task 14
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

for (const tool of [PinTool] as const) {
  registerTool(tool);
}
