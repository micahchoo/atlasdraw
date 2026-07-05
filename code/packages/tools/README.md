# @atlasdraw/tools

Geo-aware drawing tools for Atlasdraw: pin, polygon, polyline, freehand,
text label, arrow, rectangle, and circle — each producing geo-anchored
Excalidraw elements.

Workspace-internal package (not published). Consumed by `apps/atlas-app`.

> [!IMPORTANT]
> These are **not** Excalidraw custom tools. The vendored Excalidraw v0.18
> has no `customTools` registration API. Each tool is an `AtlasdrawTool`
> object that `apps/atlas-app` dispatches to itself via an interaction
> overlay (`apps/atlas-app/src/hooks/useAtlasdrawTool.ts`): the overlay
> captures pointer events, builds a `ToolContext` from the
> `(map, excalidrawAPI)` tuple, and calls the tool's handlers. See
> `.claude/rules/excalidraw-api.md` for why this distinction is load-bearing.

## Capabilities

- **8 tools** — `PinTool`, `PolygonTool`, `PolylineTool`, `FreehandTool`,
  `TextLabelTool`, `ArrowTool`, `RectangleTool`, `CircleTool`, each with its
  own test file.
- **`classifyTool`** — maps an element back to the tool that produced it.
- **`convert.ts`** — element ↔ geo conversion helpers shared by the tools.
- Exported individually from `src/index.ts` — there is no registry array or
  runtime registration seam today (plugin registration is a Phase 7 roadmap
  item).

## Usage

```ts
import { PinTool, classifyTool } from "@atlasdraw/tools";
```

## Development

```bash
yarn workspace @atlasdraw/tools test       # vitest
yarn test:typecheck
```

Architecture notes: [`docs/architecture/subsystems/tools/`](../../../docs/architecture/subsystems/tools/).

## License

MPL-2.0 (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
