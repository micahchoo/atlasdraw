# @atlasdraw/tools

Map tools for Atlasdraw: the pin, the Measure tool's state machine, unit text, and the converter from drawn shapes to GeoJSON. `PinTool` is the one drawing tool; the native Excalidraw toolbar draws every other shape.

Workspace-internal package (not published). Consumed by `apps/atlas-app`.

> [!IMPORTANT] These are **not** Excalidraw custom tools. The vendored Excalidraw v0.18 has no `customTools` registration API. Each tool is an `AtlasdrawTool` object that `apps/atlas-app` dispatches to itself via an interaction overlay (`apps/atlas-app/src/hooks/useAtlasdrawTool.ts`): the overlay captures pointer events, builds a `ToolContext` from the `(map, excalidrawAPI)` tuple, and calls the tool's handlers. See `.claude/rules/excalidraw-api.md` for why this distinction is load-bearing.

## Capabilities

- **`PinTool`** — the one built-in tool, dispatched by `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`.
- **`classifyTool`** — maps an element back to the tool that produced it.
- **`convert.ts`** — `drawingToFeatureCollection` / `annotationToFeatureCollection`: drawn elements to GeoJSON, through the document's world frame. GeoJSON export and convert-to-data-layer both use it.
- **Measuring** — `measureStep` (the Measure tool's path as a pure state machine) and `formatLength` / `formatArea` / `unitSystemForLocale` (metric or imperial text, scaled to size).
- **`registerTool` / `getTool` / `listTools`** — lookup-by-id, so a tool can arrive without a compile-time import. `PinTool` self-registers at module load.

## Usage

```ts
import { PinTool, classifyTool } from "@atlasdraw/tools";
```

## Development

```bash
yarn workspace @atlasdraw/tools test       # vitest
yarn test:typecheck
```

## License

MPL-2.0 (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
