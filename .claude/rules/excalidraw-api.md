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

TypeScript refuses a wrong prop name on `<Excalidraw>` (TS2322: the app
typechecks against the fork's built `.d.ts`). It cannot refuse a wrong name in
a doc, a comment, or an `AppState` field written through `as`. Before code or
a doc names an Excalidraw prop, field, factory or method, find it in the fork
(`code/packages/`):

- Props — `excalidraw/types.ts` `interface ExcalidrawProps`. A name missing
  there is usually an `AppState` field (`interface AppState`, same file) and
  goes in `initialData.appState`.
- Atlasdraw's own props are in the same interface, marked "Atlasdraw
  addition": `screenSizedStyles`, `stampNewElements`, `placementBlocked`,
  `onZoomAction`, `onSidebarLayoutChange` and others. They are not upstream
  API; upstream docs do not describe them.
- Imperative API — `interface ExcalidrawImperativeAPI`, same file. `onChange`
  returns an unsubscribe function.
- Creating an element — the factories in `element/src/newElement.ts`
  (`newElement`, `newTextElement`, …). `newElementWith` lives in
  `mutateElement.ts` and copies an existing element with changes; it creates
  nothing new. A new element on the map also needs its scene unit
  (`world-coordinates.md`): the fork's own paths get it from
  `stampNewElements`; app code that builds an element writes it itself.
- Custom tools — there is no tool registration. Atlas tools dispatch through
  an overlay; copy `apps/atlas-app/src/hooks/useAtlasdrawTool.ts`.

If the grep finds nothing, the name is wrong. Choose the AppState route, a
factory or the overlay before you write the code.
