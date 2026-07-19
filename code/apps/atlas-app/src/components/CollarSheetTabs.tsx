// SPDX-License-Identifier: AGPL-3.0-only
//
// CollarSheetTabs — layer sheet-edge tabs in the right column of the Collar
// frame. Each tab toggles a tab of Excalidraw's DefaultSidebar (the same
// surface the floating trigger button used to open — that button is hidden
// in collar mode, see vendored LayerUI). Open state tracks
// appState.openSidebar via excalidrawAPI.onChange.

import { useEffect, useState } from "react";

import { DEFAULT_SIDEBAR } from "@atlasdraw/common";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import styles from "../styles/CollarSheetTabs.module.css";

const TABS = [
  { tab: "layers", label: "Layers" },
  { tab: "comments", label: "Comments" },
  { tab: "library", label: "Library" },
] as const;

interface CollarSheetTabsProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

export function CollarSheetTabs({ excalidrawAPI }: CollarSheetTabsProps) {
  const [openTab, setOpenTab] = useState<string | null>(null);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    // onChange fires on every appState commit — cheap derive + set (React
    // bails out when the value is unchanged).
    return excalidrawAPI.onChange((_elements, appState) => {
      setOpenTab(
        appState.openSidebar?.name === DEFAULT_SIDEBAR.name
          ? appState.openSidebar.tab ?? null
          : null,
      );
    });
  }, [excalidrawAPI]);

  if (!excalidrawAPI) {
    return null;
  }

  return (
    <>
      {TABS.map(({ tab, label }) => {
        const expanded = openTab === tab;
        return (
          <button
            key={tab}
            type="button"
            className={[styles.tab, expanded ? styles.tabExpanded : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() =>
              excalidrawAPI.toggleSidebar({ name: DEFAULT_SIDEBAR.name, tab })
            }
            aria-expanded={expanded}
            data-testid={`collar-tab-${tab}`}
          >
            {label}
          </button>
        );
      })}
    </>
  );
}
