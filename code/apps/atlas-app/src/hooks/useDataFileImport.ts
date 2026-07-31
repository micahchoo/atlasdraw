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
  decodeGeoTiff,
  encodeRasterPng,
  RasterDecodeError,
  UnsupportedRasterCrsError,
} from "@atlasdraw/data";
import { defaultLayerStyle } from "@atlasdraw/basemap";

import { requireHomogeneousGeometry } from "@atlasdraw/data";

import { getAppConfig } from "../config/app-config";

import { useToast } from "../components/ToastProvider";

import { addDataLayerToMap, addRasterLayerToMap } from "../lib/dataLayerRender";
import { useRasterImageStore } from "../state/useRasterImageStore";

import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type {
  LayerProvenance,
  LayerStyle,
  RasterCorners,
} from "../state/layerRegistry";

type DataFileExt = "geojson" | "csv" | "zip" | "geotiff";

/**
 * Formats the app cannot read *yet*, as opposed to formats that are simply not
 * data files. FU-1: raster import is PRD §4 job 1 and is not built, so a
 * dropped GeoTIFF is a gap in this app and not a mistake by the user — and the
 * error has to say which. "unsupported file type" sends someone off to convert
 * a file that was already correct.
 *
 * Nothing routes on this map; it only picks the wording. Delete an entry the
 * day its importer lands, and `detectExt` will claim the extension first.
 */
const KNOWN_UNBUILT: ReadonlyArray<{ exts: string[]; label: string }> = [
  // GeoTIFF's entry was deleted when RA-4 landed its importer, which is the
  // mechanism this list exists for: `detectExt` claims the extension first, so
  // a stale entry here would be unreachable rather than wrong.
  { exts: [".gpkg"], label: "GeoPackage" },
  { exts: [".kml", ".kmz"], label: "KML" },
  { exts: [".gpx"], label: "GPX" },
];

function unbuiltFormatLabel(fileName: string): string | null {
  const name = fileName.toLowerCase();
  for (const { exts, label } of KNOWN_UNBUILT) {
    if (exts.some((e) => name.endsWith(e))) {
      return label;
    }
  }
  return null;
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
  // FU-1. `.tif`/`.tiff` are ambiguous by extension — plenty are plain images
  // with no georeferencing — so this only claims the routing. The decoder is
  // what decides whether the file can be placed, and says so by name.
  if (
    name.endsWith(".tif") ||
    name.endsWith(".tiff") ||
    name.endsWith(".geotiff")
  ) {
    return "geotiff";
  }
  return null;
}

/**
 * Parse a dropped/picked file by extension. Throws the parser's own error types.
 *
 * Returns the FC alongside the number of input records the parse discarded.
 * Only CSV discards anything (a row with no usable coordinates is skipped so
 * one bad line can't fail a 10k-row file); GeoJSON and shapefile reject the
 * whole file instead, so 0 from those branches is a fact rather than a
 * placeholder. The count is recorded as layer provenance — see
 * `LayerProvenance` in state/layerRegistry.
 */
async function parseDroppedFile(
  file: File,
  ext: Exclude<DataFileExt, "geotiff">,
): Promise<{ fc: FeatureCollection; dropped: number }> {
  if (ext === "csv") {
    const geocoderConfig = getAppConfig().geocoder;
    let dropped = 0;
    const fc = await parseCSV(file, {
      ...(geocoderConfig
        ? {
            geocoder: new PhotonGeocoder({ endpoint: geocoderConfig.endpoint }),
          }
        : {}),
      onStats: (stats) => {
        dropped = stats.dropped;
      },
    });
    return { fc, dropped };
  }
  if (ext === "zip") {
    return { fc: await parseShapefile(file), dropped: 0 };
  }
  return { fc: await parse(file), dropped: 0 };
}

/**
 * Features that made it into the FC but will never render: `geometry: null` is
 * RFC 7946-legal and survives `parse()`'s validation, yet MapLibre draws
 * nothing for it. Counted as dropped so the panel's number matches what the
 * user can actually see on the map.
 */
function countNullGeometries(fc: FeatureCollection): number {
  return fc.features.reduce((n, f) => (f.geometry ? n : n + 1), 0);
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
    provenance?: LayerProvenance;
  }) => void,
  /**
   * Called after a layer has been added to the map AND registered — i.e. only
   * on the success path, never after a parse/render failure. Import is the one
   * "what did I just get?" beat where both personas want the sheet panel (design
   * doc §5), so MapEditor uses this to open it. Optional: the two existing
   * MapEditor import tests construct the hook without it.
   */
  onImported?: () => void,
  /**
   * FU-1. Appended rather than slotted next to `registerDataLayer` where it
   * belongs, because moving `onImported` would break every existing call site
   * for a cosmetic gain. Optional for the same reason — the MapEditor tests
   * that construct this hook with four arguments predate rasters and have none
   * to import.
   */
  registerRasterLayer?: (opts: {
    id: string;
    label: string;
    corners: RasterCorners;
    imageKey: string;
    provenance?: LayerProvenance;
  }) => void,
): UseDataFileImportResult {
  const toast = useToast();

  /**
   * The raster path. Separate from `processDataDrop` rather than a branch
   * inside it, because the two share nothing after the file object: no
   * FeatureCollection, no geometry homogeneity check, no layer style, a
   * different registry call and a different map write. Folding them together
   * would mean four `if (ext === "geotiff")` escapes inside one function.
   */
  const processRasterDrop = useCallback(
    async (file: File) => {
      if (!map) {
        return;
      }
      try {
        const decoded = await decodeGeoTiff(await file.arrayBuffer());
        const png = await encodeRasterPng(decoded);
        if (!png) {
          // No OffscreenCanvas: nothing to hand MapLibre and nothing to save.
          toast.error(
            `${file.name}: this browser cannot encode the image for import`,
          );
          return;
        }

        const id = `rl:${crypto.randomUUID()}`;
        const imageKey = `raster-${id.slice(3)}.png`;
        // Image store before the map, and the map before the registry: the
        // registry subscriber reconciles new entries onto the map and reads
        // the URL from the store, so writing it last would have it find a
        // raster with no image and skip it. Same ordering rule as the data
        // path, one store deeper.
        useRasterImageStore.getState().set(id, png);
        const url = useRasterImageStore.getState().get(id)!.url;
        addRasterLayerToMap(map, id, url, decoded.corners, 1);
        registerRasterLayer?.({
          id,
          label: file.name,
          corners: decoded.corners,
          imageKey,
          provenance: { sourceFile: file.name, droppedCount: 0 },
        });

        toast.success(`${file.name}: imported as a ${decoded.crs} image`);
        onImported?.();
      } catch (err) {
        if (err instanceof UnsupportedRasterCrsError) {
          // The whole point of the separate error type. "Reproject this" is
          // actionable; "import failed" would send someone to check a file
          // that was never the problem.
          console.error("[MapEditor] raster CRS unsupported:", err.message);
          toast.error(
            `${file.name}: this image is in ${err.crs}. Reproject it to EPSG:4326 and try again.`,
          );
          return;
        }
        if (err instanceof RasterDecodeError) {
          console.error("[MapEditor] raster decode failed:", err.message);
          toast.error(`${file.name}: ${err.message}`);
          return;
        }
        console.error("[MapEditor] raster import failed unexpectedly:", err);
        toast.error(`${file.name}: import failed unexpectedly`);
      }
    },
    [map, registerRasterLayer, toast, onImported],
  );

  const processDataDrop = useCallback(
    async (file: File, ext: Exclude<DataFileExt, "geotiff">) => {
      if (!map) {
        return;
      }
      try {
        const { fc, dropped } = await parseDroppedFile(file, ext);
        requireHomogeneousGeometry(fc);
        const id = `dl:${crypto.randomUUID()}`;
        const style = defaultLayerStyle(fc);
        // Map mutations first, registry second: the registry subscriber
        // (useLayerRegistrySync) reconciles registry→map on new entries, and
        // adding here first means it finds this layer already present.
        // addDataLayerToMap owns the addSource/addLayer + orphan-source
        // rollback so an imported layer and a re-added one are byte-identical.
        addDataLayerToMap(map, id, fc, style);
        registerDataLayer({
          id,
          fc,
          label: file.name,
          style,
          provenance: {
            sourceFile: file.name,
            droppedCount: dropped + countNullGeometries(fc),
          },
        });
        const n = fc.features.length;
        toast.success(
          `${file.name}: ${n} feature${n === 1 ? "" : "s"} imported`,
        );
        onImported?.();
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
    [map, registerDataLayer, toast, onImported],
  );

  const importFile = useCallback(
    (file: File) => {
      const ext = detectExt(file.name);
      if (!ext) {
        const unbuilt = unbuiltFormatLabel(file.name);
        toast.error(
          unbuilt
            ? `${file.name}: ${unbuilt} import isn't supported yet — atlasdraw reads .geojson, .csv and zipped shapefiles`
            : `${file.name}: unsupported file type — expected .geojson, .csv, or .zip`,
        );
        return;
      }
      if (ext === "geotiff") {
        void processRasterDrop(file);
        return;
      }
      void processDataDrop(file, ext);
    },
    [processDataDrop, processRasterDrop, toast],
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
      if (ext === "geotiff") {
        void processRasterDrop(file);
        return;
      }
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
  }, [processDataDrop, processRasterDrop, rootRef]);

  return { importFile };
}
