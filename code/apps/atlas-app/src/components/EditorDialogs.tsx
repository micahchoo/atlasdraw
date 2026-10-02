// SPDX-License-Identifier: AGPL-3.0-only
//
// EditorDialogs: the one dialog the session has open (session/view.ts
// #dialog), mounted at the editor's root. The menu, the palette and the keys
// only set the dialog; this shows it. Mounted outside the main menu, whose
// auto-close would unmount a dialog it held.
//
// Every dialog here is a Modal (components/Modal.tsx). The slot read where
// focus goes back when the dialog opened (view.returnFocus); this hands that
// to the Modal, because by the time it mounts a menu item that opened it is
// gone.

import React, { Suspense, lazy, useCallback, useMemo } from "react";

import { drawingToFeatureCollection } from "@atlasdraw/tools";

import { getAppConfig } from "../config/app-config";
import { paletteCommands, shortcutRows } from "../commands/commands";
import { keyText } from "../commands/keys";
import { useExportPNG } from "../hooks/useExportPNG";
import { exportCompositeDataURL } from "../lib/export";
import { captureView, type MapView } from "../lib/mapView";
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
import { createHttpStorageClient } from "../services/createHttpStorageClient";

import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { ReturnFocusContext } from "./Modal";
import { MyMapsDialog } from "./MyMapsDialog";
import { OnboardingTips } from "./OnboardingTips";
import { PinDetailsDialog } from "./PinDetailsDialog";
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
  const returnFocus = useView((s) => s.returnFocus);

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

  // The live map as one value: camera, bearing, size, frame and credits.
  const capture = useCallback(
    (): MapView | null =>
      map ? captureView(map, session.store.getState().doc.snapshot()) : null,
    [map, session],
  );

  // The PDF's picture is the same composite the PNG export makes, so the two
  // formats agree about what an export holds. The map's own canvas has no
  // drawn shapes on it. The page prints the credit as text, so the image
  // carries none.
  const mapImage = useCallback(
    async (view: MapView, pixelRatio: number): Promise<string> => {
      if (!map || !api) {
        throw new Error("The map is not ready. Try again in a moment.");
      }
      return exportCompositeDataURL(map, api, view, {
        pixelRatio,
        backgroundColor: background,
        credit: false,
      });
    },
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
  return (
    <ReturnFocusContext.Provider value={returnFocus}>
      {shown()}
    </ReturnFocusContext.Provider>
  );

  function shown(): React.ReactNode {
    if (!dialog) {
      return null;
    }
    switch (dialog.kind) {
      case "onboarding":
        return <OnboardingTips onDismiss={close} />;
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
              captureView={capture}
              renderImage={mapImage}
              getLegendEntries={legend}
            />
          </Suspense>
        );
      case "pin-details":
        return api ? (
          <PinDetailsDialog api={api} pinId={dialog.pinId} onClose={close} />
        ) : null;
      case "asset-library":
        return <AssetLibraryPanel excalidrawAPI={api} onCloseRequest={close} />;
      case "my-maps":
        return api ? (
          <MyMapsDialog
            excalidrawAPI={api}
            map={map}
            persistence={session.persistence}
            history={session.history}
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
}
