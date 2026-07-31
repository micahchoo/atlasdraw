import React from "react";

// `../../index`, not `../..` — FU-8. A bare `../..` resolves the package
// DIRECTORY, so Vite reads packages/excalidraw/package.json and follows
// `main` to ./dist/prod/index.js. With no dist/ that silently falls back to
// this same source file and everything passes; once `test:typecheck` has
// built dist/, the test loads the BUNDLE instead and dies on a null
// useTunnels. Naming the entry file removes the dependency on build state.
import { Excalidraw } from "../../index";
import {
  GlobalTestState,
  queryByTestId,
  render,
  withExcalidrawDimensions,
} from "../../tests/test-utils";

export const assertSidebarDockButton = async <T extends boolean>(
  hasDockButton: T,
): Promise<
  T extends false
    ? { dockButton: null; sidebar: HTMLElement }
    : { dockButton: HTMLElement; sidebar: HTMLElement }
> => {
  const sidebar =
    GlobalTestState.renderResult.container.querySelector<HTMLElement>(
      ".sidebar",
    );
  expect(sidebar).not.toBe(null);
  const dockButton = queryByTestId(sidebar!, "sidebar-dock");
  if (hasDockButton) {
    expect(dockButton).not.toBe(null);
    return { dockButton: dockButton!, sidebar: sidebar! } as any;
  }
  expect(dockButton).toBe(null);
  return { dockButton: null, sidebar: sidebar! } as any;
};

export const assertExcalidrawWithSidebar = async (
  sidebar: React.ReactNode,
  name: string,
  test: () => void,
) => {
  await render(
    <Excalidraw initialData={{ appState: { openSidebar: { name } } }}>
      {sidebar}
    </Excalidraw>,
  );
  await withExcalidrawDimensions({ width: 1920, height: 1080 }, test);
};
