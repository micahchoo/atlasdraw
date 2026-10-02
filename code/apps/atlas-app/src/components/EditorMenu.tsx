// SPDX-License-Identifier: AGPL-3.0-only
//
// The editor's main menu: the commands in commands.ts#MAIN_MENU, in that
// order. Rendered as a child of <Excalidraw>, where it replaces the drawing
// editor's own menu.

import { MainMenu } from "@atlasdraw/excalidraw";

import { MAIN_MENU, commandById } from "../commands/commands";
import { keyText } from "../commands/keys";
import { useSession, useView } from "../session/SessionContext";

/** `main-menu-<name>`: the part of the command id after the group. */
export function menuTestId(id: string): string {
  return `main-menu-${id.slice(id.indexOf(".") + 1)}`;
}

export function EditorMenu() {
  const session = useSession();
  // Render again when a command comes or goes, not on every view change.
  const shown = useView(() =>
    MAIN_MENU.map((id) =>
      id === "---" ? id : commandById(id)?.available(session) ? id : "",
    ).join(" "),
  )
    .split(" ")
    .filter(Boolean);

  return (
    <MainMenu>
      {shown.map((id, i) => {
        if (id === "---") {
          return <MainMenu.Separator key={`sep-${i}`} />;
        }
        const command = commandById(id)!;
        const key = command.keys?.[0];
        return (
          <MainMenu.Item
            key={id}
            onSelect={() => command.run(session)}
            shortcut={key ? keyText(key) : undefined}
            data-testid={menuTestId(id)}
          >
            {command.label}
          </MainMenu.Item>
        );
      })}
    </MainMenu>
  );
}
