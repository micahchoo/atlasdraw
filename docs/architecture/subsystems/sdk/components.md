# `packages/sdk` — Components

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (per Q5, decisions/0002-license-split.md)
**Package name:** `@atlasdraw/sdk`
**Phase:** Scaffold Phase 6 Task 4a; `AtlasdrawAPI` interface Phase 6 Task 1; `AtlasdrawEmbed` + `mount()` Phase 6 Task 4b; API bridge Phase 6 Task 4c

---

## Overview

`packages/sdk` is the lean, MIT-licensed embed widget. It renders an Atlasdraw editor in an iframe and exposes a postMessage-safe `AtlasdrawAPI` to the host page. The SDK has no dependency on the AGPL-licensed `apps/atlas-app` codebase at build time — it communicates with the iframe at runtime via postMessage. The package ships two integration paths: a React component (`<AtlasdrawEmbed>`) and a vanilla `mount()` function.

---

## Major Files and Responsibilities

### `src/api-types.ts`
**Phase:** Phase 6, Task 1 [Phase 6 plan Task 1 "AtlasdrawAPI — Async-revised interface + ADR 0005"]
**Responsibility:** TypeScript type declarations for `AtlasdrawAPI`. All method signatures are async (return `Promise<T>`) or fire-and-forget (`void`). All parameter and return types pass `structuredClone()` without throwing — no DOM nodes, no class instances, no `Map`/`Set` unless serialized. Per Q11 and ADR 0005.
**Dependencies:** none; pure type declarations
**Complexity:** ~120 lines, cyclomatic 1
[CONFIDENCE: high — per Phase 6 plan Task 1, Q11]

### `src/api.ts`
**Phase:** Phase 6, Task 1
**Responsibility:** Runtime `AtlasdrawAPI` implementation for the host side. Sends postMessage commands to the iframe and awaits responses using a request/response correlation ID map. Handles timeout on pending requests. Implements the `onReady` and event subscription patterns.
**Dependencies:** `api-types.ts`, `embed-bridge.ts`
**Complexity:** ~200 lines, cyclomatic ~12
**Key invariant:** All values crossing the postMessage boundary pass `structuredClone()`. Any attempt to send a DOM node or class instance is rejected with a `TypeError` at call time, not silently dropped.
[CONFIDENCE: high — per Phase 6 plan Task 1, ADR 0005]

### `src/AtlasdrawEmbed.tsx`
**Phase:** Phase 6, Task 4b [Phase 6 plan Task 4b]
**Responsibility:** React component. Renders an `<iframe>` pointing to the Atlasdraw editor hosted at `src`. Shows a loading skeleton while the iframe signals `EMBED_READY`. Shows an error slot on 404 or load failure. Exposes `AtlasdrawAPI` via the `onReady` callback after `EMBED_READY`. Manages focus containment (Tab key must not escape the host document without explicit user intent — per Phase 6 plan codebook `focus-management-across-boundaries`).
**Dependencies:** `api.ts`, `api-types.ts`, `embed-bridge.ts`; external: `react`
**Complexity:** ~180 lines, cyclomatic ~10
[CONFIDENCE: high — per Phase 6 plan Task 4b]

### `src/mount.ts`
**Phase:** Phase 6, Task 4b
**Responsibility:** Vanilla (non-React) `mount()` function. Creates an `<iframe>` imperatively, appends it to a provided container element, and returns a `Promise<AtlasdrawAPI>` that resolves when `EMBED_READY` fires. For non-React host applications.

```ts
export function mount(
  container: HTMLElement,
  opts: MountOptions
): Promise<AtlasdrawAPI>;

export function unmount(container: HTMLElement): void;
```

**Dependencies:** `api.ts`, `embed-bridge.ts`; external: none (no React)
**Complexity:** ~80 lines, cyclomatic ~5
[CONFIDENCE: high — per Phase 6 plan Task 4b]

### `src/embed-bridge.ts`
**Phase:** Phase 6, Task 4c
**Responsibility:** The postMessage bridge. Defines the message protocol (command types, request IDs, response envelope format). Used by both `api.ts` (host side) and by `embed-renderer.ts` (iframe side). Ensures both sides use the same protocol constants.

```ts
export type BridgeMessage = CommandMessage | ResponseMessage | EventMessage;
export type CommandMessage = { type: "command"; id: string; method: string; args: unknown[] };
export type ResponseMessage = { type: "response"; id: string; result?: unknown; error?: string };
export type EventMessage  = { type: "event"; name: string; payload: unknown };
```

**Complexity:** ~80 lines, cyclomatic ~6
[CONFIDENCE: med — protocol shape extrapolated from ADR 0005 constraints]

### `src/embed-renderer.ts`
**Phase:** Phase 6, Task 4b
**Responsibility:** Runs inside the Atlasdraw iframe. Listens for `CommandMessage`s from the host, dispatches them to the editor's `AtlasdrawAPI` methods, and posts `ResponseMessage`s back. Signals `EMBED_READY` via postMessage after the editor's `onLoad` fires.
**Dependencies:** `embed-bridge.ts`; external: `apps/atlas-app` build artifact (bundled into the iframe page)
**Complexity:** ~100 lines, cyclomatic ~8
[CONFIDENCE: med — iframe-side renderer is implied by the postMessage pattern; exact structure extrapolated]

### `src/index.ts`
**Phase:** Phase 6, Task 4a (scaffold), Task 4b (populated)
**Responsibility:** Barrel export. Exports `AtlasdrawEmbed`, `mount`, `unmount`, `AtlasdrawAPI` type.
**Complexity:** ~10 lines

---

## Cross-Subsystem Notes

- `packages/sdk` communicates with the editor at runtime via postMessage. At build time it has no import dependency on `apps/atlas-app`.
- `packages/geo` types (`GeoAnchor`) appear in `AtlasdrawAPI` method signatures — they must be structured-clone-compatible (plain objects, not class instances). `GeoAnchor` is a plain discriminated union object, so it passes. [CONFIDENCE: high]
- Phase 7 plugin sandbox consumes `AtlasdrawAPI` interface — it is frozen from Phase 6 onward (per Phase 6 produces contract).
- `decisions/0005-sdk-postmessage-contract.md` is the ADR governing the postMessage boundary.
