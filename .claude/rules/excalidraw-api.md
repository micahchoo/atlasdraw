---
scope:
  - code/apps/atlas-app/**
  - code/packages/tools/**
  - code/packages/geo/**
tags: [excalidraw, plan-literal-divergence]
priority: high
source: hand-written
---

# Excalidraw API: grep before you trust the plan

Before any worker brief, plan section, or implementation that **names an Excalidraw API** (prop, hook, factory, type, lifecycle event), grep the vendored source first. The plan literal may diverge from v0.18 reality.

## Mandatory checks

When the plan/spec/prior decision names:

- An `<Excalidraw>` prop → grep `code/packages/excalidraw/types.ts` for `ExcalidrawProps`. If absent, the prop is an `AppState` field and goes via `initialData.appState`, not as a top-level prop.
- An element factory (`newElement`, `newTextElement`, `newElementWith`, etc.) → grep `code/packages/element/src/newElement.ts`. `newElementWith` **mutates** an existing element; for creation use the factory functions in `@excalidraw/element`.
- A "custom tools" registration → there is **no `customTools` prop in v0.18**. Atlas-side tools dispatch via overlay (see `code/apps/atlas-app/src/hooks/useAtlasdrawTool.ts` for the established pattern).
- An imperative API method (`onChange`, `updateScene`, `getSceneElements`) → grep `code/packages/excalidraw/types.ts` for `ExcalidrawImperativeAPI`. The return type may be `UnsubscribeCallback` (cleanup signature differs from typical event listeners).
- An AppState field (`viewBackgroundColor`, `theme`, `gridSize`, `editingElement`, `newElement`) → grep `code/packages/excalidraw/types.ts` for `interface AppState`. Goes in `initialData.appState`, NOT as a top-level prop.

## Why this rule exists

Recurring failure mode (3 instances logged):

- **viewBackgroundColor footgun** (Wave 3a): plan said `<Excalidraw viewBackgroundColor="transparent">`. v0.18 silently accepted the unknown prop (loose `ExcalidrawProps` type), painted white over the map. Lives in AppState.
- **customTools non-existence** (Wave 3b): plan said "use Excalidraw's custom tool registration." v0.18 has no such prop. Caught only by pre-dispatch scrub.
- **newElementWith mutates** (Wave 3b): plan said "use newElementWith or newTextElement." `newElementWith` mutates an existing element; for new creation use `newElement` / `newTextElement` / `newRectangleElement` factories.

TypeScript will not catch these — `ExcalidrawProps` is loose enough to silently accept unknown props, and the plan-text doesn't typecheck. The grep is the gate.

## How to apply

Before writing a worker brief or shipping code:

1. List every Excalidraw API named in the plan or your draft.
2. For each, run a `grep` against the vendored source paths above.
3. Pin the verified literal — file path + line number — into the brief or comment. Workers copy verbatim from briefs; if you don't pin it, the wrong literal propagates.
4. If grep returns nothing, the plan is wrong. Decide an alternative (overlay, AppState route, factory swap) before dispatching.

Cheaper than catching it post-render via white-screen-of-death or "tool integration didn't compile."
