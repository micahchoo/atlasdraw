// SPDX-License-Identifier: AGPL-3.0-only
//
// Can the map draw this data-layer style? One answer for every path that
// sets a style: the style panel before it commits, the document reducer at
// dispatch, the room's record check and the document gate. The answer is
// MapLibre's own validator, run on the layers the style compiles to.
//
// Pure: no map, no document. The reducer imports it, so it must not import
// anything that reads the open document.

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

import {
  compileLayers,
  filterProblem,
  labelProblem,
  type LayerStyle,
} from "@atlasdraw/basemap";

import type { AtlasGeometryKind } from "@atlasdraw/data";

import type {
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";

/** The source kinds an overlay uses. */
export type OverlaySourceType = "geojson" | "image" | "raster";

/** A source of the right type with no payload, for validating a layer. */
const EMPTY_SOURCES: Record<OverlaySourceType, SourceSpecification> = {
  raster: {
    type: "raster",
    tiles: ["https://example.org/{z}/{x}/{y}.png"],
    tileSize: 256,
  },
  geojson: {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  },
  image: {
    type: "image",
    url: "",
    coordinates: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  },
};

/** Glyphs and a font to validate a label layer with; never fetched. */
const CHECK_GLYPHS = "https://example.org/{fontstack}/{range}.pbf";
const CHECK_FONT = ["Check Regular"];

/**
 * MapLibre's objections to these layers, or an empty list. Uses the same
 * validator MapLibre runs inside addLayer and setPaintProperty.
 */
export function validateLayers(
  layers: readonly LayerSpecification[],
  sourceType: OverlaySourceType,
): string[] {
  const sources: Record<string, SourceSpecification> = {};
  for (const layer of layers) {
    if ("source" in layer && typeof layer.source === "string") {
      sources[layer.source] = EMPTY_SOURCES[sourceType];
    }
  }
  // A symbol layer with text needs glyphs in the style. Whether the basemap
  // has them is the caller's question (labelFont); this checks the layers.
  const hasText = layers.some((l) => l.type === "symbol");
  const style: StyleSpecification = {
    version: 8,
    ...(hasText ? { glyphs: CHECK_GLYPHS } : {}),
    sources,
    layers: [...layers],
  };
  return validateStyleMin(style).map((e) => e.message);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Why a style's label or filter cannot be applied, or null. A value of the
 * wrong shape (a style from a file or a peer) is a problem, not a throw.
 */
export function styleProblem(style: unknown): string | null {
  if (typeof style !== "object" || style === null || Array.isArray(style)) {
    return "The style is not a set of style fields.";
  }
  const { filter, label } = style as LayerStyle;
  try {
    return (
      (filter ? filterProblem(filter) : null) ??
      (label ? labelProblem(label) : null)
    );
  } catch (err) {
    return `The style cannot be read: ${messageOf(err)}`;
  }
}

/**
 * MapLibre's objections to a data-layer style, or an empty list. A style
 * MapLibre rejects is never stored. A label is checked as if the basemap had
 * glyphs: whether it has is a different question, which the panel answers
 * on its own.
 */
export function validateLayerStyle(
  style: unknown,
  geometryKind: AtlasGeometryKind,
): string[] {
  const problem = styleProblem(style);
  if (problem) {
    return [problem];
  }
  try {
    return validateLayers(
      compileLayers("check", style as LayerStyle, geometryKind, {
        labelFont: CHECK_FONT,
      }),
      "geojson",
    );
  } catch (err) {
    return [`The style cannot be drawn: ${messageOf(err)}`];
  }
}
