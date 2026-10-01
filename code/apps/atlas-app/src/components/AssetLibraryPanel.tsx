// SPDX-License-Identifier: AGPL-3.0-only
// Asset library info panel + dialog.
//
// We extend Excalidraw's OWN library UI via `excalidrawAPI.updateLibrary({
// libraryItems, merge: true })`. We do NOT create a parallel `<Sidebar
// name="library">` — that name (and "libraries") is reserved by Excalidraw
// v0.18 (`code/packages/common/src/constants.ts:432` defines
// `LIBRARY_SIDEBAR_TAB = "library"`; `LIBRARY_SIDEBAR_TAB` is a *tab* of
// `DEFAULT_SIDEBAR`, not a sidebar name). Mounting a parallel sidebar with
// the same name would collide.
//
// This dialog is therefore a small info / launcher panel:
//   1. On mount it pushes the 3 atlas-curated libraries into Excalidraw's
//      built-in library via `updateLibrary({ libraryItems, merge: true })`.
//   2. Renders a list of the 3 library groups with item counts so the user
//      knows what's available (Excalidraw's library UI is a flat tile grid
//      with no grouping).
//   3. Provides a "View in Excalidraw library" button that opens Excalidraw's
//      built-in library sidebar via
//      `toggleSidebar({ name: DEFAULT_SIDEBAR.name, tab: LIBRARY_SIDEBAR_TAB })`.
//      (NOT `toggleSidebar({ name: "library" })` — the addressable form is a
//      tab on DEFAULT_SIDEBAR; see ui-conventions skill + library.ts:302.)
//   4. Renders an MIT-license attribution footer.
//
// We use `excalidrawAPI` (the Excalidraw imperative API) directly — there is
// no atlasdraw-side automation surface.
//
// A Modal: Escape and a press outside close it, focus starts on Close and
// stays inside, and goes back to what opened it.

import React, { useEffect, useMemo } from "react";
import { DEFAULT_SIDEBAR, LIBRARY_SIDEBAR_TAB } from "@atlasdraw/common";

import { getBuiltInLibraries, type ExcalidrawLibrary } from "@atlasdraw/data";

import type {
  ExcalidrawImperativeAPI,
  LibraryItem,
} from "@atlasdraw/excalidraw/types";

import { Modal } from "./Modal";
import { useToast } from "./ToastProvider";

export interface AssetLibraryPanelProps {
  /**
   * Excalidraw imperative API. Required for two operations:
   *  - `updateLibrary` on mount (push built-in fixtures into the library)
   *  - `toggleSidebar` when user clicks "View in Excalidraw library"
   *
   * The dialog still renders if the API isn't ready (e.g. mid-init); both
   * operations no-op rather than throw.
   */
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onCloseRequest: () => void;
}

interface LibraryGroup {
  source: string;
  /** Display label derived from the source field ("atlasdraw:wildfire-icons" → "Wildfire icons"). */
  label: string;
  itemCount: number;
}

function deriveLabel(source: string | undefined): string {
  if (!source) {
    return "Library";
  }
  // "atlasdraw:wildfire-icons" → "wildfire-icons" → "Wildfire icons"
  const tail = source.split(":").pop() ?? source;
  const spaced = tail.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function aggregateLibraryItems(libs: ExcalidrawLibrary[]): LibraryItem[] {
  const items: LibraryItem[] = [];
  for (const lib of libs) {
    for (const item of lib.libraryItems) {
      items.push(item);
    }
  }
  return items;
}

function summarizeGroups(libs: ExcalidrawLibrary[]): LibraryGroup[] {
  return libs.map((lib) => ({
    source: lib.source ?? "unknown",
    label: deriveLabel(lib.source),
    itemCount: lib.libraryItems.length,
  }));
}

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({
  excalidrawAPI,
  onCloseRequest,
}) => {
  const toast = useToast();

  // Compute once: built-in libraries + aggregated items + group summary.
  // getBuiltInLibraries() reads from bundled fixtures (Vite import.meta.glob
  // at build time). Result is stable for the dialog's lifetime.
  const { libraries, items, groups } = useMemo(() => {
    const libs = getBuiltInLibraries();
    return {
      libraries: libs,
      items: aggregateLibraryItems(libs),
      groups: summarizeGroups(libs),
    };
  }, []);

  // On mount: push the aggregated items into Excalidraw's built-in library.
  // `merge: true` so we don't clobber any library items the user already
  // imported. `updateLibrary` is async — we attach a `.catch` so a malformed
  // fixture surfaces to the user via toast (and to devtools via console)
  // rather than as an unhandled rejection nobody sees.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    if (items.length === 0) {
      return;
    }
    excalidrawAPI
      .updateLibrary({ libraryItems: items, merge: true })
      .catch((err: unknown) => {
        console.warn("AssetLibraryPanel updateLibrary failed:", err);
        toast.error("Couldn't load the built-in asset libraries");
      });
  }, [excalidrawAPI, items, toast]);

  const handleViewInLibrary = () => {
    if (!excalidrawAPI) {
      return;
    }
    // Addressable form: the Library is a TAB of DEFAULT_SIDEBAR, not a
    // sidebar itself. Confirmed against
    // `code/packages/common/src/constants.ts:432-438` and the precedent in
    // `code/packages/excalidraw/data/library.ts:302`.
    excalidrawAPI.toggleSidebar({
      name: DEFAULT_SIDEBAR.name,
      tab: LIBRARY_SIDEBAR_TAB,
    });
    onCloseRequest();
  };

  return (
    <Modal
      label="Asset library"
      onClose={onCloseRequest}
      scrimStyle={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
      scrimTestId="asset-library-dialog-overlay"
      style={{
        background: "var(--color-surface, #fff)",
        borderRadius: "0.5rem",
        padding: "1rem",
        width: "min(90vw, 480px)",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        fontSize: "0.875rem",
        color: "var(--ad-ink, #1f2937)",
      }}
      testId="asset-library-dialog"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <h2
          style={{
            fontSize: "1rem",
            margin: 0,
            fontWeight: 600,
          }}
        >
          Asset library
        </h2>
        <button
          autoFocus
          type="button"
          onClick={onCloseRequest}
          aria-label="Close asset library dialog"
          data-testid="asset-library-close"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "0.25rem 0.5rem",
            fontSize: "1.25rem",
            lineHeight: 1,
            color: "var(--ad-ink-secondary, #4b5563)",
          }}
        >
          ×
        </button>
      </div>

      <p
        style={{
          marginTop: 0,
          marginBottom: "0.75rem",
          color: "var(--ad-ink-secondary, #4b5563)",
        }}
      >
        {items.length} curated items across {groups.length} libraries are
        available in Excalidraw's built-in library panel.
      </p>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0 0 1rem 0",
        }}
        data-testid="asset-library-groups"
      >
        {groups.map((group) => (
          <li
            key={group.source}
            data-testid={`asset-library-group-${group.source}`}
            style={{
              padding: "0.5rem 0",
              borderBottom: "1px solid var(--ad-rule, #e5e7eb)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontWeight: 500 }}>{group.label}</span>
            <span style={{ color: "var(--ad-ink-tertiary, #6b7280)" }}>
              {group.itemCount} items
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={handleViewInLibrary}
        disabled={!excalidrawAPI}
        aria-label="View in Excalidraw library"
        data-testid="asset-library-view"
        style={{
          width: "100%",
          padding: "0.5rem 0.75rem",
          background: "var(--ad-accent, #6965db)",
          color: "var(--ad-ink-inverse, #fff)",
          border: "none",
          borderRadius: "0.25rem",
          cursor: excalidrawAPI ? "pointer" : "not-allowed",
          opacity: excalidrawAPI ? 1 : 0.6,
          fontSize: "0.875rem",
          marginBottom: "0.75rem",
        }}
      >
        View in Excalidraw library
      </button>

      <footer
        style={{
          fontSize: "0.75rem",
          color: "var(--ad-ink-tertiary, #6b7280)",
          borderTop: "1px solid var(--ad-rule, #e5e7eb)",
          paddingTop: "0.75rem",
        }}
        data-testid="asset-library-attribution"
      >
        <div style={{ marginBottom: "0.25rem", fontWeight: 500 }}>
          License attribution
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {libraries.map((lib) => (
            <li
              key={lib.source ?? "anon"}
              data-testid={`asset-library-license-${lib.source ?? "anon"}`}
            >
              {deriveLabel(lib.source)} — MIT (atlasdraw contributors, 2026)
            </li>
          ))}
        </ul>
      </footer>
    </Modal>
  );
};
