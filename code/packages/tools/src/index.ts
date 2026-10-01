// @atlasdraw/tools — public surface.
// T14

// PinTool is the one built-in tool. The native Excalidraw toolbar draws
// every other shape. `classifyTool`, the `AtlasdrawTool` type, the converter
// and the tool registry (for tools registered from outside) are public.
//
// The generic registry factory is duplicated (not shared via
// @atlasdraw/common) for the same reason packages/basemap's
// BasemapRegistry.ts duplicates it: the root tsconfig.json's composite
// project graph excludes @atlasdraw/common from the atlas-owned package
// graph both basemap and tools belong to.
import { PinTool } from "./PinTool.js";

import type { AtlasdrawTool } from "./types.js";
export * from "./types.js";
export { classifyTool } from "./classifyTool.js";
export { PinTool } from "./PinTool.js"; // Phase 1 Wave 3b Task 14
// Phase 2 Wave 2b additions:
export {
  annotationToFeatureCollection,
  drawingToFeatureCollection,
  elementGeometry,
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
// W9 — measuring.
export { formatArea, formatLength, unitSystemForLocale } from "./units.js";
export type { UnitSystem } from "./units.js";
export { IDLE_MEASURE, measureStep, shownPath } from "./measureSession.js";
export type { MeasureEvent, MeasureState } from "./measureSession.js";
