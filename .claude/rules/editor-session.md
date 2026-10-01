---
paths:
  - code/apps/atlas-app/src/**
tags: [session, commands, state]
priority: high
source: hand-written
---

# atlas-app: one EditorSession, one command list

`MapEditor` creates one `EditorSession` (`src/session/EditorSession.ts`) and
provides it with `SessionProvider`. Everything under it, the Layers tab
included, reads it with `useSession()` / `useView()` / `usePersistence()`. A
tab registered with `registerSidebarTab` renders inside `<Excalidraw>`, so it
is in the provider's tree: "it cannot take props" is never a reason for a
module store.

- **New editor state goes in the session**, never in a module-level store:
  view state in `session/view.ts`, autosave state in
  `state/persistenceState.ts`. A module store is shared by every editor and
  every test, and needs a reset hook. Code that is not a component takes the
  session (or the store it needs) as a parameter.
- **The session holds no logic.** It hands the same instances to everyone.
  An action belongs in a module that takes the session: `session/fileActions.ts`,
  `commands/commands.ts`.
- **Every menu item, palette entry and editor key is a `Command`** in
  `commands/commands.ts`. `EditorMenu`, the palette (`EditorDialogs`),
  `useCommandKeys` and the shortcuts panel read that one list.
  `commands.test.ts` fails when two commands take one key, when a command
  takes a key the drawing keeps (`EDITOR_KEYS`), or when a menu entry is
  not registered. Add a key there, never in a component's own `keydown`.
- **`useCommandKeys` listens on the window in the capture phase.** The
  drawing stops the keys it handles at its own root, and it binds ⌘K (link)
  and `?` (help); a bubbling listener does not hear them. A key that a
  command takes never reaches the drawing.
- **One dialog at a time**: `view.dialog`, shown by `EditorDialogs`. A
  yes/no question is `view.ask()`, which resolves with the answer.

Still module-level, on purpose or not yet moved: the open document
(`state/document.ts#useDocumentStore`, injected as `session.store`), the
drawing published for the Layers panel (`state/scene.ts#useSceneStore`), the
comment anchor picker and focus event buses, and the app-wide announcer
(`AriaAnnouncer`, one live region for the page).

Verify with `cd code && npx vitest run apps/atlas-app/src/session
apps/atlas-app/src/commands`, then `e2e/command-surfaces.spec.ts`.
