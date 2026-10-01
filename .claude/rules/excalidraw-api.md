---
paths:
  - code/apps/atlas-app/**
  - code/packages/tools/**
  - code/packages/geo/**
tags: [excalidraw]
priority: high
source: hand-written
---

# Excalidraw API: grep the vendored source before you name an API

`ExcalidrawProps` is loose: `<Excalidraw>` accepts a prop that does not exist
and does nothing with it, so TypeScript cannot catch a wrong name. Before code
or a doc names an Excalidraw prop, field, factory or method, find it in the
vendored source (`code/packages/`):

- Props — `excalidraw/types.ts` `interface ExcalidrawProps`. A name missing
  there is usually an `AppState` field (`interface AppState`, same file) and
  goes in `initialData.appState`. `viewBackgroundColor` passed as a prop once
  painted the map white.
- Imperative API — `interface ExcalidrawImperativeAPI`, same file. `onChange`
  returns an unsubscribe function.
- Creating an element — the factories in `element/src/newElement.ts`
  (`newElement`, `newTextElement`, …). `newElementWith` lives in
  `mutateElement.ts` and copies an existing element with changes; it creates
  nothing new.
- Custom tools — v0.18 has no tool registration. Atlas tools dispatch through
  an overlay; copy `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`.

If the grep finds nothing, the name is wrong. Choose the AppState route, a
factory or the overlay before you write the code.
