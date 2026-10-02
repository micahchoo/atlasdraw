// SPDX-License-Identifier: AGPL-3.0-only
//
// Excalidraw's theme, made the app's theme.
//
// "Dark or light theme" sets Excalidraw's `appState.theme`, and Excalidraw puts
// `theme--dark` on its own container only. The app's panels, its dialogs (which
// mount outside that container) and the collar hosts read the --ad-* tokens,
// so the tokens switch on <html>: `data-ad-theme="dark"` (styles/tokens.css).
// Not `data-theme`, which high-contrast.css owns.

import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

const ATTRIBUTE = "data-ad-theme";

function mark(theme: string): void {
  const root = document.documentElement;
  if (theme === "dark") {
    root.setAttribute(ATTRIBUTE, "dark");
  } else {
    root.removeAttribute(ATTRIBUTE);
  }
}

export function useThemeAttribute(api: ExcalidrawImperativeAPI | null): void {
  useEffect(() => {
    if (!api) {
      return;
    }
    let theme = api.getAppState().theme;
    mark(theme);
    const unsubscribe = api.onChange((_elements, appState) => {
      // onChange fires on every pointer move; touch the DOM only on a change.
      if (appState.theme !== theme) {
        theme = appState.theme;
        mark(theme);
      }
    });
    return () => {
      unsubscribe();
      mark("light");
    };
  }, [api]);
}
