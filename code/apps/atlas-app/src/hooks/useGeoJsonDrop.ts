// SPDX-License-Identifier: AGPL-3.0-only
// Extracted from MapEditor.tsx (2026-05-25) — data-file drag-and-drop import.
//
// Wires capture-phase DOM listeners on a root element so .geojson and .csv
// files are intercepted before Excalidraw's bubble-phase handler consumes
// them. Other files pass through for Excalidraw's native image/library drops.
//
// CSV rows need lat/lng columns (auto-detected by @atlasdraw/data's parseCSV);
// address-only CSVs additionally need the operator-configured Photon geocoder
// (config.geocoder — ADR-0006/0011, zero call-home, no default endpoint).

import { useCallback, useEffect } from "react";

import {
  parse,
  parseCSV,
  GeoJSONParseError,
  CSVParseError,
  PhotonGeocoder,
} from "@atlasdraw/data";
import { compileLayer, defaultLayerStyle } from "@atlasdraw/basemap";

import { requireHomogeneousGeometry } from "@atlasdraw/data";

import { getAppConfig } from "../config/app-config";

import { useToast } from "../components/ToastProvider";

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

/** Parse a dropped file by extension. Throws the parser's own error types. */
async function parseDroppedFile(
  file: File,
  ext: "geojson" | "csv",
): Promise<FeatureCollection> {
  if (ext === "csv") {
    const geocoderConfig = getAppConfig().geocoder;
    return parseCSV(
      file,
      geocoderConfig
        ? {
            geocoder: new PhotonGeocoder({ endpoint: geocoderConfig.endpoint }),
          }
        : undefined,
    );
  }
  return parse(file);
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
  const toast = useToast();

  const processDataDrop = useCallback(
    async (file: File, ext: "geojson" | "csv") => {
      if (!map) {
        return;
      }
      try {
        const fc = await parseDroppedFile(file, ext);
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
        const n = fc.features.length;
        toast.success(
          `${file.name}: ${n} feature${n === 1 ? "" : "s"} imported`,
        );
      } catch (err) {
        if (err instanceof GeoJSONParseError) {
          console.error("[MapEditor] GeoJSON parse failed:", err.message);
          toast.error(`GeoJSON import failed — ${err.message}`);
          return;
        }
        if (err instanceof CSVParseError) {
          console.error("[MapEditor] CSV parse failed:", err.message);
          // NO_COORD_COLUMNS on an address-only CSV means "no geocoder
          // configured" from the user's point of view — say so.
          const hint =
            err.code === "NO_COORD_COLUMNS" && !getAppConfig().geocoder
              ? " (address-only CSVs need a geocoder — see the VITE_GEOCODER_ENDPOINT setting)"
              : "";
          toast.error(`CSV import failed — ${err.message}${hint}`);
          return;
        }
        // Anything else (e.g. MapLibre rejecting an addLayer spec) would
        // otherwise become a silent unhandled rejection — processDataDrop
        // is invoked fire-and-forget (`void processDataDrop(...)`) by the
        // drop listener, so nothing downstream ever sees this throw.
        console.error("[MapEditor] import failed unexpectedly:", err);
        toast.error(`${file.name}: import failed unexpectedly`);
      }
    },
    [map, registerDataLayer, toast],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const onDropCapture = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) {
        return;
      }
      const name = file.name.toLowerCase();
      const ext = name.endsWith(".geojson")
        ? ("geojson" as const)
        : name.endsWith(".csv")
        ? ("csv" as const)
        : null;
      if (!ext) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void processDataDrop(file, ext);
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
  }, [processDataDrop, rootRef]);
}
