# @atlasdraw/tools

Geo-aware drawing tools for Atlasdraw. `PinTool` is the only one — the seven Phase 2 Wave 1b tools (polygon, polyline, freehand, text label, arrow, rectangle, circle) were deleted 2026-07-31 after three sessions of looking turned up no caller and no behaviour the native Excalidraw toolbar does not already produce (FU-2).

Workspace-internal package (not published). Consumed by `apps/atlas-app`.

> [!IMPORTANT] These are **not** Excalidraw custom tools. The vendored Excalidraw v0.18 has no `customTools` registration API. Each tool is an `AtlasdrawTool` object that `apps/atlas-app` dispatches to itself via an interaction overlay (`apps/atlas-app/src/hooks/useAtlasdrawTool.ts`): the overlay captures pointer events, builds a `ToolContext` from the `(map, excalidrawAPI)` tuple, and calls the tool's handlers. See `.claude/rules/excalidraw-api.md` for why this distinction is load-bearing.

## Capabilities

- **`PinTool`** — the one built-in tool, dispatched by `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`.
- **`classifyTool`** — maps an element back to the tool that produced it.
- **`convert.ts`** — element ↔ geo conversion helpers.
- **`registerTool` / `getTool` / `listTools`** — lookup-by-id, so a tool can arrive without a compile-time import. `PinTool` self-registers at module load; this is the seam plugin registration would use.

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
