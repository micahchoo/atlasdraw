// SPDX-License-Identifier: AGPL-3.0-only
// Extracted from MapEditor.tsx (2026-05-25); renamed from useGeoJsonDrop
// (ISSUES.md Direction 1) once it grew beyond GeoJSON to also cover CSV and
// (now) Shapefile — "useGeoJsonDrop" undersold what this hook actually does.
//
// Two trigger paths funnel into the same processDataDrop pipeline:
//   1. Drag-and-drop — capture-phase DOM listeners on a root element so
//      .geojson/.csv/.zip files are intercepted before Excalidraw's
//      bubble-phase handler consumes them. Other files pass through for
//      Excalidraw's native image/library drops.
//   2. A deliberate "Import…" menu action — MapEditor calls the returned
//      `importFile(file)` after a native file picker resolves a File (see
//      the fallbackOpen pattern in state/persistence.ts for the picker
//      itself). Unlike an accidental drag, a deliberate pick that doesn't
//      match a supported format gets an explicit toast, not a silent no-op.
//
// CSV rows need lat/lng columns (auto-detected by @atlasdraw/data's parseCSV);
// address-only CSVs additionally need the operator-configured Photon geocoder
// (config.geocoder — ADR-0006/0011, zero call-home, no default endpoint).
//
// Shapefile bundles are a single .zip (parseShapefile takes one Blob — shpjs
// handles the zip extraction internally). A zip containing multiple .shp
// layers gets flattened into one FeatureCollection by parseShapefile itself
// (no per-layer provenance) — if those layers have mixed geometry types, the
// requireHomogeneousGeometry check below rejects it with its normal generic
// message. That's a known, accepted limitation for this pass: teasing layers
// apart would mean changing parseShapefile's merge behavior in
// @atlasdraw/data, not just this hook.

import { useCallback, useEffect } from "react";

import {
  parse,
  parseCSV,
  parseShapefile,
  GeoJSONParseError,
  CSVParseError,
  ShapefileParseError,
  PhotonGeocoder,
} from "@atlasdraw/data";
import { compileLayer, defaultLayerStyle } from "@atlasdraw/basemap";

import { requireHomogeneousGeometry } from "@atlasdraw/data";

import { getAppConfig } from "../config/app-config";

import { useToast } from "../components/ToastProvider";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { LayerStyle } from "../state/layerRegistry";

type DataFileExt = "geojson" | "csv" | "zip";

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

/** Extension routing shared by both the drop handler and the file picker. */
function detectExt(fileName: string): DataFileExt | null {
  const name = fileName.toLowerCase();
  if (name.endsWith(".geojson")) {
    return "geojson";
  }
  if (name.endsWith(".csv")) {
    return "csv";
  }
  if (name.endsWith(".zip")) {
    return "zip";
  }
  return null;
}

/** Parse a dropped/picked file by extension. Throws the parser's own error types. */
async function parseDroppedFile(
  file: File,
  ext: DataFileExt,
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
  if (ext === "zip") {
    return parseShapefile(file);
  }
  return parse(file);
}

/** Human-readable message per ShapefileParseError code. */
function shapefileErrorMessage(err: ShapefileParseError): string {
  switch (err.code) {
    case "BAD_ZIP":
      return "That doesn't look like a valid zip file";
    case "NO_SHP_FILE":
      return "No .shp file found in that zip";
    case "PARSE_FAILED":
      return `Couldn't parse the shapefile — ${err.message}`;
  }
}

export interface UseDataFileImportResult {
  /** Imperatively import a file — used by a deliberate file-picker action
   * (e.g. the "Import…" menu item), as opposed to drag-drop. Unlike
   * drag-drop's silent no-op on an unrecognized extension, this surfaces an
   * explicit toast — a user who deliberately picked a file has a much
   * higher expectation of feedback than one who dragged something in by
   * accident. */
  importFile: (file: File) => void;
}

export function useDataFileImport(
  rootRef: React.RefObject<HTMLDivElement | null>,
  map: maplibregl.Map | null,
  registerDataLayer: (opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
  }) => void,
): UseDataFileImportResult {
  const toast = useToast();

  const processDataDrop = useCallback(
    async (file: File, ext: DataFileExt) => {
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
        if (err instanceof ShapefileParseError) {
          console.error("[MapEditor] Shapefile parse failed:", err.message);
          toast.error(
            `Shapefile import failed — ${shapefileErrorMessage(err)}`,
          );
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

  const importFile = useCallback(
    (file: File) => {
      const ext = detectExt(file.name);
      if (!ext) {
        toast.error(
          `${file.name}: unsupported file type — expected .geojson, .csv, or .zip`,
        );
        return;
      }
      void processDataDrop(file, ext);
    },
    [processDataDrop, toast],
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
      const ext = detectExt(file.name);
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

  return { importFile };
}
