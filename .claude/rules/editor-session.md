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
  `state/persistenceState.ts`, undo and "unsaved" in `session/history.ts`
  (`one-history.md`). A module store is shared by every editor and
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
- **A key goes to one scope** (`commands/keyScopes.ts`, `session.keys`).
  The stack has one listener, on the window in the capture phase: the
  drawing stops the keys it handles at its own root, and it binds ⌘K (link)
  and `?` (help), so a bubbling listener does not hear them. The newest
  dialog hears a key first; with no dialog, the tools (Measure, the Pin,
  comment mode) from the newest down; the commands (`useCommandKeys`) hear
  what is left. A tool that needs keys pushes a `tool` scope while it is
  on (`useKeyScope`), never a `keydown` listener of its own: that is how
  Measure took a dialog's Enter.
- **One dialog at a time**: `view.dialog`, shown by `EditorDialogs`. A
  yes/no question is `view.ask()`, which resolves with the answer. A
  question that loses the slot is answered no. While the slot is set, no
  command runs, unless the dialog on top names it (`Modal`'s `commands`).
- **Every dialog renders through `components/Modal.tsx`**, a question inside
  a dialog too. It owns the role, the name, focus in and back, Tab, Escape,
  the scrim and the inert page. A dialog that writes its own `keydown` for
  Escape or its own focus trap is the seven-copies defect coming back.
  Focus goes back to `view.returnFocus`, read when the dialog opens.

Still module-level, on purpose or not yet moved: the open document
(`state/document.ts#useDocumentStore`, injected as `session.store`), the
drawing published for the Layers panel (`state/scene.ts#useSceneStore`), the
comment anchor picker and focus event buses, and the app-wide announcer
(`AriaAnnouncer`, one live region for the page).

Verify with `cd code && npx vitest run apps/atlas-app/src/session
apps/atlas-app/src/commands`, then `e2e/command-surfaces.spec.ts` and
`e2e/keyboard.spec.ts` (focus order is the browser's; jsdom cannot show it).
