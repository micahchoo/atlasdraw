// SPDX-License-Identifier: AGPL-3.0-only
//
// EditorDialogs: the one dialog the session has open (session/view.ts
// #dialog), mounted at the editor's root. The menu, the palette and the keys
// only set the dialog; this shows it. Mounted outside the main menu, whose
// auto-close would unmount a dialog it held.

import React, { Suspense, lazy, useCallback, useMemo } from "react";

import { getBasemap } from "@atlasdraw/basemap";
import { drawingToFeatureCollection } from "@atlasdraw/tools";

import { getAppConfig } from "../config/app-config";
import { paletteCommands, shortcutRows } from "../commands/commands";
import { keyText } from "../commands/keys";
import { useExportPNG } from "../hooks/useExportPNG";
import { exportCompositeDataURL, measureView } from "../lib/export";
import { exportLegendEntries } from "../lib/legend";
import {
  geoJsonExportFile,
  type GeoJsonExportOptions,
} from "../lib/dataLayerExport";
import { downloadBlob } from "../lib/download";
import { saveMap } from "../session/fileActions";
import { useSession, useView } from "../session/SessionContext";
import { annotationRows } from "../state/annotations";
import { liveCamera, toFile } from "../state/documentIO";
import { useDocument } from "../state/document";
import { createHttpStorageClient } from "../services/createHttpStorageClient";

import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { MyMapsDialog } from "./MyMapsDialog";
import { QuickActions, type QuickAction } from "./QuickActions";
import { ShareDialog } from "./ShareDialog";

import type { LayerLegendEntry } from "../lib/print-pdf";

// Behind a click, so their code (pdf-lib most of all, through ExportDialog)
// stays out of the boot chunk. A dialog that appears a frame later is
// invisible to the user, so the fallback is nothing.
const AboutDialog = lazy(() =>
  import("./AboutDialog").then((m) => ({ default: m.AboutDialog })),
);
const SettingsDialog = lazy(() =>
  import("./SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
const ExportDialog = lazy(() =>
  import("./ExportDialog").then((m) => ({ default: m.ExportDialog })),
);

export interface EditorDialogsProps {
  /**
   * Make a room from the open map, or keep the editor's room; resolves with
   * its URL. Null when the editor offers no rooms.
   */
  startRoom: (() => Promise<string>) | null;
}

export function EditorDialogs({ startRoom }: EditorDialogsProps) {
  const session = useSession();
  const dialog = useView((s) => s.dialog);
  const map = useView((s) => s.map);
  const api = useView((s) => s.api);
  const background = useView((s) => s.mapBackground);
  const close = useView((s) => s.closeDialog);
  const basemap = useDocument((s) => s.basemap);
  const attribution = getBasemap(basemap)?.attribution;

  const storage = useMemo(
    () =>
      createHttpStorageClient({
        baseUrl: getAppConfig().storageBaseUrl ?? "",
      }),
    [],
  );

  const exportPNG = useExportPNG(map, api, background, session.notify);

  const exportGeoJSON = useCallback(
    (opts: GeoJsonExportOptions) => {
      if (!api) {
        return;
      }
      const state = session.store.getState().doc.snapshot();
      // The drawn shapes, then the data layers; the drawing's converter
      // never sees a data layer.
      const fc = drawingToFeatureCollection(
        api.getSceneElements(),
        state.world,
      );
      const file = geoJsonExportFile(fc, state, opts);
      downloadBlob(new Blob([file.text], { type: file.type }), file.fileName);
    },
    [api, session],
  );

  // The PDF's picture is the same composite the PNG export makes, so the two
  // formats agree about what an export holds. The map's own canvas has no
  // drawn shapes on it.
  const mapImage = useCallback(
    async (pixelRatio: number): Promise<string | null> =>
      map && api
        ? exportCompositeDataURL(map, api, {
            pixelRatio,
            backgroundColor: background,
          })
        : null,
    [map, api, background],
  );

  // The legend describes the exported page: a hidden layer, or a layer with
  // nothing in this view, is left out. Read at export time, like the image.
  const legend = useCallback((): LayerLegendEntry[] => {
    if (!map || !api) {
      return [];
    }
    const state = session.store.getState().doc.snapshot();
    return exportLegendEntries(
      [
        ...annotationRows(api.getSceneElements(), state.world),
        ...state.overlays,
      ],
      map,
      api,
    );
  }, [map, api, session]);

  const paletteActions = (): QuickAction[] =>
    paletteCommands(session).map((c) => ({
      id: c.id,
      label: c.label,
      category: c.group,
      hint: c.keys?.[0] ? keyText(c.keys[0]) : undefined,
      keywords: c.keywords ? [...c.keywords] : undefined,
      onSelect: () => c.run(session),
    }));

  if (!dialog) {
    return null;
  }
  switch (dialog.kind) {
    case "palette":
      return <QuickActions actions={paletteActions()} onClose={close} />;
    case "shortcuts":
      return <KeyboardShortcuts rows={shortcutRows()} onClose={close} />;
    case "confirm":
      return (
        <ConfirmDialog
          title={dialog.title}
          body={dialog.body}
          confirmLabel={dialog.confirmLabel}
          cancelLabel={dialog.cancelLabel}
          tone={dialog.tone}
          onConfirm={() => dialog.answer(true)}
          onCancel={() => dialog.answer(false)}
        />
      );
    case "about":
      return (
        <Suspense fallback={null}>
          <AboutDialog onCloseRequest={close} />
        </Suspense>
      );
    case "settings":
      return (
        <Suspense fallback={null}>
          <SettingsDialog onCloseRequest={close} />
        </Suspense>
      );
    case "export":
      return (
        <Suspense fallback={null}>
          <ExportDialog
            initialFormat={dialog.format}
            onCloseRequest={close}
            onExportPNG={exportPNG}
            onExportGeoJSON={exportGeoJSON}
            onExportAtlasdraw={() => void saveMap(session, session.notify)}
            getView={() => (map ? measureView(map) : null)}
            getMapImageDataUrl={mapImage}
            // The PDF's north arrow: the screen angle of geographic east,
            // the angle the drawing layer is turned by.
            getCameraRotationDeg={() => (map ? -map.getBearing() : 0)}
            getLegendEntries={legend}
            attribution={attribution}
          />
        </Suspense>
      );
    case "asset-library":
      return <AssetLibraryPanel excalidrawAPI={api} onCloseRequest={close} />;
    case "my-maps":
      return api ? (
        <MyMapsDialog
          excalidrawAPI={api}
          map={map}
          persistence={session.persistence}
          notify={session.notify}
          onClose={close}
          server={getAppConfig().enableBackendPersistence ? storage : null}
        />
      ) : null;
    case "share":
      return api ? (
        <ShareDialog
          onCloseRequest={close}
          getDoc={() =>
            toFile(session.store.getState().doc, undefined, liveCamera(map))
          }
          client={storage}
          startRoom={startRoom}
        />
      ) : null;
  }
}
