// SPDX-License-Identifier: AGPL-3.0-only
// Extracted from MapEditor.tsx (2026-05-25) — GeoJSON drag-and-drop import.
//
// Wires capture-phase DOM listeners on a root element so .geojson files are
// intercepted before Excalidraw's bubble-phase handler consumes them.
// Non-.geojson files pass through for Excalidraw's native image/library drops.

import { useCallback, useEffect } from "react";

import {
  parse,
  GeoJSONParseError,
  requireHomogeneousGeometry,
} from "@atlasdraw/data";
import { compileLayer, defaultLayerStyle } from "@atlasdraw/basemap";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { LayerStyle } from "../state/layerRegistry";

function inferGeometryType(fc: FeatureCollection): "fill" | "line" | "circle" {
  const t = fc.features[0]?.geometry?.type;
  if (t === "Polygon" || t === "MultiPolygon") {
    return "fill";
  }
  if (t === "LineString" || t === "MultiLineString") {
    return "line";
  }
  return "circle";
}

export function useGeoJsonDrop(
  rootRef: React.RefObject<HTMLDivElement | null>,
  map: maplibregl.Map | null,
  registerDataLayer: (opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
  }) => void,
): void {
  const processGeoJsonDrop = useCallback(
    async (file: File) => {
      if (!map) {
        return;
      }
      try {
        const fc = await parse(file);
        requireHomogeneousGeometry(fc);
        const id = `dl:${crypto.randomUUID()}`;
        const style = defaultLayerStyle(fc);
        const geometryType = inferGeometryType(fc);
        map.addSource(id, { type: "geojson", data: fc });
        try {
          map.addLayer(compileLayer(id, style, geometryType));
        } catch (layerErr) {
          try {
            map.removeSource(id);
          } catch {
            /* swallow */
          }
          throw layerErr;
        }
        registerDataLayer({ id, fc, label: file.name, style });
      } catch (err) {
        if (err instanceof GeoJSONParseError) {
          console.error("[MapEditor] GeoJSON parse failed:", err.message);
          window.alert(`GeoJSON parse failed: ${err.message}`);
          return;
        }
        throw err;
      }
    },
    [map, registerDataLayer],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const onDropCapture = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.name.endsWith(".geojson")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void processGeoJsonDrop(file);
    };
    const onDragOverCapture = (e: DragEvent) => {
      e.preventDefault();
    };
    root.addEventListener("drop", onDropCapture, { capture: true });
    root.addEventListener("dragover", onDragOverCapture, { capture: true });
    return () => {
      root.removeEventListener("drop", onDropCapture, { capture: true });
      root.removeEventListener("dragover", onDragOverCapture, {
        capture: true,
      });
    };
  }, [processGeoJsonDrop, rootRef]);
}
