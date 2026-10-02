// SPDX-License-Identifier: AGPL-3.0-only
//
// The drawing's right-click menus, built from the command list
// (commands.ts). A command names its menus in `contexts`; this module
// registers one item for each with the fork
// (`excalidrawAPI.registerContextMenuItem`). Nothing else registers an item,
// so a right-click item is always a command, and the palette lists it too
// (contextMenus.test.ts).
//
// The fork has two menus. Each context lives in one of them:
//
//   canvas   the canvas menu (a right-click on no shape)
//   feature  the canvas menu, when a data feature is under the click
//   element  the element menu (a right-click on shapes)
//   pin      the element menu, when the selection is one pin
//
// The fork's own items come first: Paste, Select all on the canvas; cut,
// copy, order, group, lock and delete on a shape. These items follow them.

import { useEffect } from "react";

import { selectedPin } from "../state/pinDetails";

import { COMMANDS } from "./commands";

import type {
  Command,
  CommandGroup,
  MenuContext,
  MenuTarget,
} from "./commands";
import type { EditorSession } from "../session/EditorSession";
import type {
  ExcalidrawImperativeAPI,
  ProjectContextMenuContext,
} from "@atlasdraw/excalidraw/types";

/** The fork menu that each context's items are in. */
const FORK_MENU: Record<MenuContext, ProjectContextMenuContext> = {
  canvas: "canvas",
  feature: "canvas",
  element: "element",
  pin: "element",
};

/** The order of the groups in a menu: what to do here first, settings last. */
const MENU_GROUPS: readonly CommandGroup[] = [
  "Tools",
  "File",
  "View",
  "Edit",
  "Help",
];

/** True when the command is for what the menu opened on. */
function applies(s: EditorSession, c: Command, at: MenuTarget): boolean {
  if (at.context === "pin") {
    const api = s.view.getState().api;
    if (!api || selectedPin(api) === null) {
      return false;
    }
  }
  return c.appliesAt ? c.appliesAt(s, at) : c.available(s);
}

/** The commands that name a menu, in the order the menus show them. */
function menuCommands(): Array<{ command: Command; context: MenuContext }> {
  return MENU_GROUPS.flatMap((group) =>
    COMMANDS.filter((c) => c.group === group).flatMap((command) =>
      (command.contexts ?? []).map((context) => ({ command, context })),
    ),
  );
}

/**
 * Register every command that names a menu. Returns the function that
 * removes them all.
 */
export function registerCommandMenus(
  s: EditorSession,
  api: Pick<ExcalidrawImperativeAPI, "registerContextMenuItem">,
): () => void {
  const unregister = menuCommands().map(({ command, context }) => {
    const target = (at: { clientX: number; clientY: number }): MenuTarget => ({
      context,
      clientX: at.clientX,
      clientY: at.clientY,
    });
    return api.registerContextMenuItem({
      name: `${context}:${command.id}`,
      label: command.menuLabel?.[context] ?? command.label,
      contexts: [FORK_MENU[context]],
      predicate: (_elements, _appState, at) => applies(s, command, target(at)),
      perform: (_elements, _appState, at) => {
        command.run(s, target(at));
        // The command writes what it changes itself; the fork applies
        // nothing on top.
        return false;
      },
      ...(command.checked
        ? { checked: () => command.checked?.(s) === true }
        : {}),
    });
  });
  return () => unregister.forEach((off) => off());
}

/** Register the menus while the drawing is mounted. */
export function useCommandMenus(
  s: EditorSession,
  api: ExcalidrawImperativeAPI | null,
): void {
  useEffect(() => (api ? registerCommandMenus(s, api) : undefined), [s, api]);
}
