// SPDX-License-Identifier: AGPL-3.0-only
//
// The files written for imported data layers: one layer as GeoJSON, CSV,
// KML or GPX (the layer panel's ⋯ menu), and all data layers added to the drawn-shape
// GeoJSON (the Export dialog's "Include imported data layers").
//
// Only data layers have features. A raster is a picture and a tile layer
// stays on its server, so neither can be written as vector data, and the
// panel does not offer it.

import {
  csvGeometryMode,
  toCSV,
  toGPX,
  toGeoJSONText,
  toKML,
} from "@atlasdraw/data";

import { safeFileName } from "./safeFileName";

import type { DataLayerEntry, DocumentState } from "../state/document";
import type { FeatureCollection } from "geojson";

export type DataExportFormat = "geojson" | "csv" | "kml" | "gpx";

export interface ExportFile {
  fileName: string;
  /** Media type for the Blob. */
  type: string;
  text: string;
}

/** One "Export as …" item of a data layer's menu. */
export interface ExportChoice {
  format: DataExportFormat;
  label: string;
}

/**
 * The formats a data layer can be written as, in menu order. GPX holds
 * waypoints and tracks only, so an area layer is not offered it. The CSV
 * label says when lines or areas go out as WKT, so the user does not expect
 * longitude and latitude columns.
 */
export function exportChoices(
  entry: Pick<DataLayerEntry, "geometryKind">,
  fc: FeatureCollection | undefined,
): ExportChoice[] {
  return [
    { format: "geojson", label: "Export as GeoJSON" },
    {
      format: "csv",
      label:
        !fc || csvGeometryMode(fc) === "point"
          ? "Export as CSV"
          : "Export as CSV (geometry as WKT)",
    },
    { format: "kml", label: "Export as KML" },
    ...(entry.geometryKind === "fill"
      ? []
      : [{ format: "gpx" as const, label: "Export as GPX" }]),
  ];
}

/**
 * The file for one data layer, named after its label. Null when `id` is not
 * a data layer of `state`, or the layer cannot be written as `format`.
 */
export function dataLayerFile(
  state: DocumentState,
  id: string,
  format: DataExportFormat,
): ExportFile | null {
  const entry = state.overlays.find((e) => e.id === id);
  const fc = state.featureCollections[id];
  if (
    entry?.kind !== "data" ||
    !fc ||
    !exportChoices(entry, fc).some((c) => c.format === format)
  ) {
    return null;
  }
  const stem = safeFileName(entry.label);
  switch (format) {
    case "geojson":
      return {
        fileName: `${stem}.geojson`,
        type: "application/geo+json",
        text: toGeoJSONText(fc, { name: entry.label }),
      };
    case "csv":
      return { fileName: `${stem}.csv`, type: "text/csv", text: toCSV(fc) };
    case "kml":
      return {
        fileName: `${stem}.kml`,
        type: "application/vnd.google-earth.kml+xml",
        text: toKML(fc, { name: entry.label }),
      };
    case "gpx":
      return {
        fileName: `${stem}.gpx`,
        type: "application/gpx+xml",
        text: toGPX(fc, { name: entry.label }),
      };
  }
}

/**
 * `drawn` with every feature of every data layer added after it, in layer
 * order, hidden layers included. Each data feature keeps its properties and
 * gets a `layer` property with the layer's label. A `layer` property that
 * the feature already has is replaced: the export must say where each
 * feature came from.
 */
export function withDataLayers(
  drawn: FeatureCollection,
  state: DocumentState,
): FeatureCollection {
  const added = state.overlays.flatMap((entry) => {
    const fc =
      entry.kind === "data" ? state.featureCollections[entry.id] : null;
    return (fc?.features ?? []).map((f) => ({
      ...f,
      properties: { ...f.properties, layer: entry.label },
    }));
  });
  return added.length === 0
    ? drawn
    : { ...drawn, features: [...drawn.features, ...added] };
}

export interface GeoJsonExportOptions {
  /** Add the features of every data layer (see `withDataLayers`). */
  includeDataLayers: boolean;
}

/**
 * The Export dialog's GeoJSON file: the drawn shapes in `drawn`, and the
 * data layers when the user asks for them. It is named after the document.
 */
export function geoJsonExportFile(
  drawn: FeatureCollection,
  state: DocumentState,
  opts: GeoJsonExportOptions,
): ExportFile {
  const fc = opts.includeDataLayers ? withDataLayers(drawn, state) : drawn;
  return {
    fileName: `${safeFileName(state.title)}.geojson`,
    type: "application/geo+json",
    text: toGeoJSONText(fc, { name: state.title }),
  };
}
