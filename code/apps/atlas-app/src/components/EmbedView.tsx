// SPDX-License-Identifier: AGPL-3.0-only
// EmbedView — read-only MAP embed (DIVERGENCES.md D1, flag VITE_EMBED_ENABLED).
//
// Unlike ShareView (which renders annotations on opaque white and drops the
// basemap — see PROBE-embed.md), EmbedView mounts the real MapLibre stack the
// editor uses, chromeless, so a finished map embeds in a cross-origin
// <iframe> as a live map:
//   - MapLibre basemap (from manifest.basemap.id) at the authored camera
//   - geo-anchored Excalidraw annotations, reprojected via CoordinateSync
//
// Routes (App.tsx):
//   /embed#v1:<lz>   — hash mode (self-contained)
//   /embed/<token>   — token mode
//
// Phase A scope: basemap + geo-anchored annotations. GeoJSON data layers
// (manifest.layers) are NOT rendered here yet — hash-mode payloads lose their
// layer FeatureCollections to JSON serialization, and rendering token-mode
// data layers needs useLayerRegistrySync + Map-normalized hydrate (Phase A.2).

import React, { useEffect, useMemo, useState } from "react";
import { MapCanvas, type MapCanvasInitialView } from "@atlasdraw/basemap";
import { Excalidraw } from "@atlasdraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { AtlasdrawDocument } from "@atlasdraw/data";

import { useMapRef } from "../hooks/useMapRef";
import { useBasemapStyle } from "../hooks/useBasemapStyle";
import { useCoordinateSync } from "../hooks/useCoordinateSync";
import { getAppConfig } from "../config/app-config";
import {
  loadShareDocument,
  tokenFromPath,
  type ShareLoadResult,
} from "../state/loadShareDocument";
import styles from "../styles/MapEditor.module.css";

// Read-only: disable Excalidraw's own persistence actions. The transparent
// background (so map tiles show through — contrast ShareView's opaque
// `#ffffff`) is set via each mount's `initialData.appState` below.
const EMBED_UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false as const,
  },
} as const;

type ViewState = { kind: "loading" } | ShareLoadResult;

export interface EmbedViewProps {
  /** Test seam — override the HTTP client. */
  client?: Parameters<typeof loadShareDocument>[2];
  /** Test seam — override the location source for path / hash. */
  location?: { pathname: string; hash: string };
}

export const EmbedView: React.FC<EmbedViewProps> = ({ client, location }) => {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    const loc = location ?? {
      pathname: window.location.pathname,
      hash: window.location.hash,
    };
    let cancelled = false;

    void (async () => {
      const token = tokenFromPath(loc.pathname, "/embed/");
      const result = await loadShareDocument(loc.hash, token, client);
      if (!cancelled) {
        setState(result);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, location]);

  if (state.kind === "loading") {
    return <EmbedMessage testid="embed-loading" title="Loading map…" />;
  }
  if (state.kind === "not-found") {
    return <EmbedMessage testid="embed-not-found" title="Map not found" />;
  }
  if (state.kind === "expired") {
    return (
      <EmbedMessage testid="embed-expired" title="This link has expired" />
    );
  }
  if (state.kind === "error") {
    return (
      <EmbedMessage
        testid="embed-error"
        title="Couldn't load map"
        body={state.message}
      />
    );
  }
  // ready — mount the map stack with the document in hand so MapCanvas gets
  // the authored camera at construction (initialView is consumed once).
  return <EmbedCanvas doc={state.doc} />;
};

const EmbedCanvas: React.FC<{ doc: AtlasdrawDocument }> = ({ doc }) => {
  const { map, onMapReady } = useMapRef();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  // Resolve + apply the authored basemap once the map is up.
  const basemapId = doc.manifest?.basemap?.id ?? "blank";
  useBasemapStyle(map, basemapId, getAppConfig().allowRemoteBasemaps);

  // Keep geo-anchored annotations pinned to the map on pan/zoom.
  const { syncNow } = useCoordinateSync(map, api);

  // Elements load via `initialData` below (Excalidraw runs them through
  // `restore`, which fills the internal fields a raw `updateScene` assumes
  // present — passing the scene straight to updateScene drops them). Once the
  // map + api are up, project the geo-anchored elements onto the camera.
  // Deferred a frame so getSceneElements() is settled (MapEditor drives the
  // equivalent post-load sync from Excalidraw's onChange).
  useEffect(() => {
    if (!map || !api) {
      return;
    }
    const raf = requestAnimationFrame(() => syncNow?.());
    return () => cancelAnimationFrame(raf);
  }, [map, api, syncNow]);

  const initialData = useMemo(
    () => ({
      elements: (doc.scene ?? []) as unknown as NonNullable<
        React.ComponentProps<typeof Excalidraw>["initialData"]
      >["elements"],
      appState: { viewBackgroundColor: "transparent" },
    }),
    [doc],
  );

  const camera = doc.manifest?.camera;
  const initialView: MapCanvasInitialView | undefined = camera
    ? { center: camera.center, zoom: camera.zoom }
    : undefined;

  return (
    <div className={styles.root} data-testid="embed-canvas">
      <div className={styles.mapLayer}>
        <MapCanvas
          initialView={initialView}
          onMapReady={onMapReady}
          className={styles.fullSize}
        />
      </div>
      {/* Top layer: transparent, read-only Excalidraw. pointer-events:none
          (from .excalidrawLayer) so the map underneath stays pannable. */}
      <div className={styles.excalidrawLayer}>
        <Excalidraw
          initialData={initialData}
          viewModeEnabled
          gridModeEnabled={false}
          onExcalidrawAPI={(a) => setApi(a)}
          UIOptions={EMBED_UI_OPTIONS}
        />
      </div>
    </div>
  );
};

const EmbedMessage: React.FC<{
  testid: string;
  title: string;
  body?: string;
}> = ({ testid, title, body }) => (
  <div
    data-testid={testid}
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      height: "100%",
      padding: "2rem",
      color: "var(--ad-ink, #212529)",
      textAlign: "center",
    }}
  >
    <h2
      style={{ margin: "0 0 0.5rem 0", fontSize: "1.25rem", fontWeight: 600 }}
    >
      {title}
    </h2>
    {body && (
      <p
        style={{
          margin: 0,
          color: "var(--ad-ink-secondary, #495057)",
          fontSize: "0.875rem",
        }}
      >
        {body}
      </p>
    )}
  </div>
);
