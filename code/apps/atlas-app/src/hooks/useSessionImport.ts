// SPDX-License-Identifier: AGPL-3.0-only
//
// The editor's data import: a drop on the plate, and the "Import data…"
// command, through one pipeline (useDataFileImport). Imported layers go
// into the open document.
//
// A first import opens the Layers panel, once per editor, unless the user
// has opened or closed the panel already: after that, their choice wins.

import { useCallback, useEffect, useRef } from "react";

import { DEFAULT_SIDEBAR } from "@atlasdraw/common";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { LngLatBox } from "@atlasdraw/geo";

import { fitMapToBox } from "../lib/fitMapToContent";

import { useDataFileImport } from "./useDataFileImport";

import type { EditorSession } from "../session/EditorSession";
import type { DocumentCommand } from "../state/document";

type AddData = Omit<
  Extract<DocumentCommand, { type: "add-data-layer" }>,
  "type"
>;
type AddRaster = Omit<
  Extract<DocumentCommand, { type: "add-raster-layer" }>,
  "type"
>;

export function useSessionImport(
  session: EditorSession,
  rootRef: React.RefObject<HTMLDivElement | null>,
  api: ExcalidrawImperativeAPI | null,
  /** True while the sheet panel is open. */
  panelOpen: boolean,
): void {
  const addDataLayer = useCallback(
    (layer: AddData) =>
      session.store
        .getState()
        .doc.dispatch({ type: "add-data-layer", ...layer }),
    [session],
  );
  const addRasterLayer = useCallback(
    (layer: AddRaster) =>
      session.store
        .getState()
        .doc.dispatch({ type: "add-raster-layer", ...layer }),
    [session],
  );

  const autoOpened = useRef(false);
  const userTouched = useRef(false);
  useEffect(() => {
    if (panelOpen) {
      userTouched.current = true;
    }
  }, [panelOpen]);
  const openPanel = useCallback(() => {
    if (autoOpened.current || userTouched.current) {
      return;
    }
    autoOpened.current = true;
    api?.toggleSidebar({
      name: DEFAULT_SIDEBAR.name,
      tab: "layers",
      force: true,
    });
  }, [api]);

  // After an import, the camera shows what came in.
  const onImported = useCallback(
    (box: LngLatBox | null) => {
      openPanel();
      if (box) {
        fitMapToBox(session.view.getState().map, box);
      }
    },
    [openPanel, session],
  );

  const { importFile } = useDataFileImport(
    rootRef,
    addDataLayer,
    onImported,
    addRasterLayer,
  );
  useEffect(() => {
    session.view.setState({ importFile });
    return () => session.view.setState({ importFile: null });
  }, [session, importFile]);
}
