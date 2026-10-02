// SPDX-License-Identifier: AGPL-3.0-only
//
// useDataFileImport — data files dropped or picked become document layers.
//
// Two ways in, one pipeline:
//   1. Drag and drop: capture-phase listeners on the root take data files
//      (.geojson, .json, .csv, .zip, .kml, .kmz, .gpx, GeoTIFF) before
//      Excalidraw's handler sees them. Other files pass through, for
//      Excalidraw's own image and library drops. Every data file of a drop
//      is imported, one after another.
//   2. The "Import…" menu: MapEditor calls `importFile(file)`. A picked file
//      in a format the app cannot read gets a message; a dragged one passes
//      through quietly.
//
// The parse runs in a Web Worker (lib/importClient), with a size limit, a
// progress toast and a Cancel button. The result is a document command; the
// map overlays draw it. Nothing here writes the map.

import { useCallback, useEffect } from "react";

import { defaultLayerStyle } from "@atlasdraw/basemap";

import type { LngLatBox } from "@atlasdraw/geo";

import { getAppConfig } from "../config/app-config";

import { useToast } from "../components/ToastProvider";

import {
  detectFormat,
  SUPPORTED_FORMATS,
  type ImportFormat,
} from "../lib/importFormat";

import { importFileOffThread, isImportCancelled } from "../lib/importClient";
import { computeFeatureCollectionBounds } from "../lib/fitMapToContent";

import type { ImportProgress } from "../lib/importPipeline";

import type { FeatureCollection } from "geojson";
import type {
  LayerProvenance,
  LayerStyle,
  RasterCorners,
} from "../state/document";

/**
 * Formats the app does not read yet, as opposed to files that are not data.
 * Only the wording depends on it: "not supported yet" tells the user the file
 * is fine.
 */
const KNOWN_UNBUILT: ReadonlyArray<{ exts: string[]; label: string }> = [
  { exts: [".gpkg"], label: "GeoPackage" },
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

function progressText(fileName: string, progress: ImportProgress): string {
  switch (progress.phase) {
    case "reading":
      return `Reading ${fileName}…`;
    case "parsing":
      return `Reading the data in ${fileName}…`;
    case "geocoding":
      return `Finding addresses in ${fileName}: ${progress.done ?? 0} of ${
        progress.total ?? 0
      }…`;
    case "encoding":
      return `Preparing the image from ${fileName}…`;
  }
}

/** The lng/lat box of a raster's corners. */
function boxOfCorners(corners: RasterCorners): LngLatBox {
  const lngs = corners.map(([lng]) => lng);
  const lats = corners.map(([, lat]) => lat);
  return {
    west: Math.min(...lngs),
    east: Math.max(...lngs),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

function union(a: LngLatBox | null, b: LngLatBox | null): LngLatBox | null {
  if (!a || !b) {
    return a ?? b;
  }
  return {
    west: Math.min(a.west, b.west),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    north: Math.max(a.north, b.north),
  };
}

export interface UseDataFileImportResult {
  /** Import a file the user picked. An unknown format gets a message. */
  importFile: (file: File) => void;
}

export function useDataFileImport(
  rootRef: React.RefObject<HTMLDivElement | null>,
  addDataLayer: (opts: {
    id: string;
    fc: FeatureCollection;
    label: string;
    style: LayerStyle;
    provenance?: LayerProvenance;
  }) => void,
  /**
   * Called after an import added its layers, never after a failure, with the
   * lng/lat box of what it added (null when nothing has a position). The
   * editor opens the sheet panel and fits the camera on it.
   */
  onImported?: (box: LngLatBox | null) => void,
  addRasterLayer?: (opts: {
    id: string;
    label: string;
    corners: RasterCorners;
    imageKey: string;
    /** The decoded PNG; the document keeps it and saves it. */
    image: Blob;
    provenance?: LayerProvenance;
  }) => void,
): UseDataFileImportResult {
  const toast = useToast();

  const runOne = useCallback(
    async (file: File, format: ImportFormat) => {
      const abort = new AbortController();
      const status = toast.progress(`Reading ${file.name}…`, () =>
        abort.abort(),
      );
      let outcome;
      try {
        outcome = await importFileOffThread(file, format, {
          signal: abort.signal,
          geocoderEndpoint: getAppConfig().geocoder?.endpoint,
          onProgress: (p) => status.update(progressText(file.name, p)),
        });
      } catch (err) {
        status.close();
        if (isImportCancelled(err)) {
          toast.info(`${file.name}: import cancelled`);
          return;
        }
        console.error("[import] failed unexpectedly:", err);
        toast.error(`${file.name}: import failed unexpectedly`);
        return;
      }
      status.close();

      if (!outcome.ok) {
        toast.error(outcome.message);
        return;
      }
      if (outcome.kind === "raster") {
        const id = `rl:${crypto.randomUUID()}`;
        addRasterLayer?.({
          id,
          label: file.name,
          corners: outcome.corners,
          imageKey: `raster-${id.slice(3)}.png`,
          image: outcome.png,
          provenance: { sourceFile: file.name, droppedCount: 0 },
        });
        toast.success(`${file.name}: imported as a ${outcome.crs} image`);
        onImported?.(boxOfCorners(outcome.corners));
        return;
      }

      let features = 0;
      let box: LngLatBox | null = null;
      for (const layer of outcome.layers) {
        box = union(box, computeFeatureCollectionBounds(layer.fc));
        addDataLayer({
          id: `dl:${crypto.randomUUID()}`,
          fc: layer.fc,
          label: layer.label,
          style: defaultLayerStyle(layer.fc),
          provenance: {
            sourceFile: file.name,
            droppedCount: layer.droppedCount,
          },
        });
        features += layer.fc.features.length;
      }
      const asLayers =
        outcome.layers.length > 1 ? ` as ${outcome.layers.length} layers` : "";
      const converted = outcome.reprojectedFrom
        ? `, converted from ${outcome.reprojectedFrom} to longitude and latitude`
        : "";
      toast.success(
        `${file.name}: ${features} feature${
          features === 1 ? "" : "s"
        } imported${asLayers}${converted}`,
      );
      onImported?.(box);
    },
    [addDataLayer, addRasterLayer, onImported, toast],
  );

  /** Import files one after another, so two large parses never overlap. */
  const runAll = useCallback(
    async (files: Array<{ file: File; format: ImportFormat }>) => {
      for (const { file, format } of files) {
        await runOne(file, format);
      }
    },
    [runOne],
  );

  const importFile = useCallback(
    (file: File) => {
      const format = detectFormat(file);
      if (!format) {
        const unbuilt = unbuiltFormatLabel(file.name);
        toast.error(
          unbuilt
            ? `${file.name}: ${unbuilt} import isn't supported yet — atlasdraw reads ${SUPPORTED_FORMATS}`
            : `${file.name}: unsupported file type — expected ${SUPPORTED_FORMATS}`,
        );
        return;
      }
      void runOne(file, format);
    },
    [runOne, toast],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const onDropCapture = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      const data = files.flatMap((file) => {
        const format = detectFormat(file);
        return format ? [{ file, format }] : [];
      });
      if (data.length === 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const skipped = files.length - data.length;
      if (skipped > 0) {
        toast.warning(
          `${skipped} of the dropped files ${
            skipped === 1 ? "is" : "are"
          } not a data file and ${skipped === 1 ? "was" : "were"} not imported`,
        );
      }
      void runAll(data);
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
  }, [runAll, rootRef, toast]);

  return { importFile };
}
