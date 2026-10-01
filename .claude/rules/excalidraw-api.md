---
paths:
  - code/apps/atlas-app/**
  - code/packages/tools/**
  - code/packages/geo/**
tags: [excalidraw]
priority: high
source: hand-written
---

# Excalidraw API: grep the fork before you name an API

`ExcalidrawProps` is loose: `<Excalidraw>` accepts a prop that does not exist
and does nothing with it, so TypeScript cannot catch a wrong name. Before code
or a doc names an Excalidraw prop, field, factory or method, find it in the
fork (`code/packages/`):

- Props — `excalidraw/types.ts` `interface ExcalidrawProps`. A name missing
  there is usually an `AppState` field (`interface AppState`, same file) and
  goes in `initialData.appState`. `viewBackgroundColor` passed as a prop once
  painted the map white.
- Atlasdraw's own props are in the same interface, marked "Atlasdraw
  addition": `screenSizedStyles`, `onZoomAction`, `onSidebarLayoutChange` and
  others. They are not upstream API; upstream docs do not describe them.
- Imperative API — `interface ExcalidrawImperativeAPI`, same file. `onChange`
  returns an unsubscribe function.
- Creating an element — the factories in `element/src/newElement.ts`
  (`newElement`, `newTextElement`, …). `newElementWith` lives in
  `mutateElement.ts` and copies an existing element with changes; it creates
  nothing new. A new element on the map also needs its scene unit
  (`world-coordinates.md`).
- Custom tools — there is no tool registration. Atlas tools dispatch through
  an overlay; copy `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`.

If the grep finds nothing, the name is wrong. Choose the AppState route, a
factory or the overlay before you write the code.
