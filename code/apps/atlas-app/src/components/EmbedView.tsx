// SPDX-License-Identifier: AGPL-3.0-only
// EmbedView — the read-only viewer, for share links (/m) and embeds (/embed).
//
// It mounts the editor's map stack without the editor:
//   - the MapLibre basemap (manifest.basemap.id) at the saved camera
//   - the document's data, raster and tile layers (useMapOverlays), opened
//     with the editor's loader (documentIO.loadDocument)
//   - the drawing, in world coordinates; the camera bridge moves
//     Excalidraw's viewport with the map (useCameraBridge)
//
// `chrome` decides what goes around the map: "minimal" for an iframe embed,
// "share" for a page of its own, with the map's title and a link that opens
// a copy in the editor.
//
// URL params (lib/embed.ts): lock=1 fixes the camera and turns off the
// attribute popup; legend=1 shows a legend; view=fit|saved says where the
// camera opens. An /embed fits its content by default; /m opens at the saved
// view. Unlocked, the map uses cooperative gestures (useEmbedCamera), so it
// never takes the page's scroll, and a click on a feature shows its
// attributes (FeaturePopup).

import React, { useEffect, useMemo, useState } from "react";
import { MapCanvas, type MapCanvasInitialView } from "@atlasdraw/basemap";
import { Excalidraw } from "@atlasdraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { AtlasdrawDocument } from "@atlasdraw/data";

import type { LngLatBox } from "@atlasdraw/geo";

import { useMapRef } from "../hooks/useMapRef";
import { useBasemapStyle } from "../hooks/useBasemapStyle";
import { useCameraBridge } from "../hooks/useCameraBridge";
import { useEmbedCamera } from "../hooks/useEmbedCamera";
import { useMapOverlays } from "../hooks/useMapOverlays";
import {
  useFeaturePopup,
  usePopupOnClick,
  type PopupMap,
} from "../hooks/useFeaturePopup";
import { creditText, documentCredits } from "../lib/mapView";
import {
  contentBox,
  parseEmbedOptions,
  type EmbedOptions,
  type ViewerChrome,
} from "../lib/embed";
import { fromFile, loadDocument } from "../state/documentIO";
import { getAppConfig } from "../config/app-config";
import { buildRoute, type SharedMap } from "../routes";
import {
  loadShareDocument,
  type ShareLoadResult,
} from "../state/loadShareDocument";
import mapStyles from "../styles/MapEditor.module.css";
import styles from "../styles/EmbedView.module.css";

import { EmbedLegend } from "./EmbedLegend";
import { FeaturePopup } from "./FeaturePopup";

// Read-only: disable Excalidraw's own persistence actions, and its help:
// the viewer has no editing keys to explain, so `?` opens nothing. The
// background is transparent (initialData below), so the map shows through.
const EMBED_UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false as const,
    toggleShortcuts: false,
  },
} as const;

type ViewState = { kind: "loading" } | ShareLoadResult;

export type { ViewerChrome };

export interface EmbedViewProps {
  chrome: ViewerChrome;
  /** The map the link names; null when the link is damaged (routes.ts). */
  map: SharedMap | null;
  /** Test seam — override the HTTP client. */
  client?: Parameters<typeof loadShareDocument>[1];
  /** Test seam — the URL's query string. */
  search?: string;
}

export const EmbedView: React.FC<EmbedViewProps> = ({
  chrome,
  map,
  client,
  search,
}) => {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await loadShareDocument(map, client);
      if (!cancelled) {
        setState(result);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, map]);

  const options = useMemo(
    () => parseEmbedOptions(search ?? window.location.search, chrome),
    [search, chrome],
  );

  if (state.kind === "loading") {
    return <ViewerMessage testid="viewer-loading" title="Loading map…" />;
  }
  if (state.kind === "not-found") {
    return (
      <ViewerMessage
        testid="viewer-not-found"
        title="Map not found"
        body="The link does not point to a map. The owner may have stopped sharing it."
      />
    );
  }
  if (state.kind === "expired") {
    return (
      <ViewerMessage
        testid="viewer-expired"
        title="This link has expired"
        body="Ask the owner for a new link."
      />
    );
  }
  if (state.kind === "error") {
    return (
      <ViewerMessage
        testid="viewer-error"
        title="Couldn't load map"
        body={state.message}
      />
    );
  }
  // The document is in hand before MapCanvas mounts, so the map starts at
  // the saved camera (initialView is read once).
  const canvas = <EmbedCanvas doc={state.doc} options={options} />;
  if (chrome === "minimal" || !map) {
    return canvas;
  }
  return (
    <div className={styles.shareRoot}>
      <header className={styles.head} data-testid="viewer-head">
        <span className={styles.wordmark}>ATLASDRAW</span>
        <h1 className={styles.title}>{state.doc.manifest.title}</h1>
        <span className={styles.readOnly}>Read-only</span>
        <span className={styles.spacer} />
        <a
          className={styles.open}
          href={buildRoute({ kind: "editor", room: null, open: map })}
        >
          Open in Atlasdraw
        </a>
      </header>
      <div className={styles.stage}>{canvas}</div>
    </div>
  );
};

const EmbedCanvas: React.FC<{
  doc: AtlasdrawDocument;
  options: EmbedOptions;
}> = ({ doc, options }) => {
  const { map, onMapReady } = useMapRef();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  // Resolve + apply the authored basemap once the map is up.
  const basemapId = doc.manifest?.basemap?.id ?? "blank";
  useBasemapStyle(map, basemapId, getAppConfig().allowRemoteBasemaps);

  // The credit line, as the editor's collar prints it: the basemap's credit
  // (data on its definition) and each visible tile layer's. MapLibre's own
  // control reads the style's sources, which carry none.
  const credit = useMemo(
    () =>
      creditText(
        documentCredits({
          basemap: basemapId,
          overlays: fromFile(doc).overlays ?? [],
        }),
      ),
    [doc, basemapId],
  );

  // Excalidraw's viewport follows the map camera.
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const { bridge, onZoomAction } = useCameraBridge(map, api, layer);

  // Draw the open document's data and raster layers on the map.
  useMapOverlays(map);

  // A click on a feature shows its attributes, unless the embed is locked.
  const popupMap = map as unknown as PopupMap | null;
  const featurePopup = useFeaturePopup(popupMap);
  usePopupOnClick(popupMap, !options.lock, featurePopup);

  // Open the document the way the editor opens a file (documentIO): its
  // layers, rasters and drawing. One loader, so the embed shows what the
  // editor shows.
  // The box of what it holds is read once it is open, for the fit.
  const [box, setBox] = useState<LngLatBox | null>(null);
  useEffect(() => {
    if (!api) {
      return;
    }
    const abort = new AbortController();
    void loadDocument(doc, api, { signal: abort.signal }).then((opened) => {
      if (opened && !abort.signal.aborted) {
        setBox(contentBox(opened.snapshot(), api.getSceneElements()));
      }
    });
    return () => abort.abort();
  }, [doc, api]);

  // Lock or cooperative gestures, and the fit to the content.
  useEmbedCamera(map, options, box);

  const initialData = useMemo(
    () => ({ appState: { viewBackgroundColor: "transparent" } }),
    [],
  );

  const camera = doc.manifest?.camera;
  const initialView: MapCanvasInitialView | undefined = camera
    ? { center: camera.center, zoom: camera.zoom }
    : undefined;

  return (
    <div className={styles.embedRoot} data-testid="viewer-canvas">
      <div className={mapStyles.mapLayer}>
        <MapCanvas
          initialView={initialView}
          onMapReady={onMapReady}
          className={mapStyles.fullSize}
          // The credit line below replaces MapLibre's control.
          hideAttribution
        />
      </div>
      {/* Top layer: transparent, read-only Excalidraw. pointer-events:none
          (from .excalidrawLayer) so the map underneath stays pannable. */}
      <div ref={setLayer} className={mapStyles.excalidrawLayer}>
        <Excalidraw
          initialData={initialData}
          viewModeEnabled
          gridModeEnabled={false}
          onExcalidrawAPI={(a) => setApi(a)}
          onScrollChange={bridge?.onScrollChange}
          onZoomAction={onZoomAction}
          UIOptions={EMBED_UI_OPTIONS}
        />
      </div>
      <FeaturePopup popup={featurePopup.popup} onClose={featurePopup.close} />
      {options.legend && <EmbedLegend map={map} api={api} />}
      {credit && (
        <div className={styles.credit} data-testid="viewer-credit">
          {credit}
        </div>
      )}
    </div>
  );
};

const ViewerMessage: React.FC<{
  testid: string;
  title: string;
  body?: string;
}> = ({ testid, title, body }) => (
  <div data-testid={testid} className={styles.message}>
    <h2 className={styles.messageTitle}>{title}</h2>
    {body && <p className={styles.messageBody}>{body}</p>}
  </div>
);
