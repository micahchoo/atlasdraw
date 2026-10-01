// SPDX-License-Identifier: AGPL-3.0-only
//
// The embed: what its URL asks for, the snippet the Share dialog gives, and
// the box it fits on load.
//
//   parseEmbedOptions(search, chrome)  the options a viewer URL carries
//   embedUrl(shareUrl, choices)        the /embed URL for a share link
//   embedSnippet(shareUrl, choices)    the <iframe> to paste into a page
//   contentBox(state, elements)        the lng/lat box of what the map holds
//
// URL options (query string, before the hash):
//   lock=1      the camera does not move: no pan, zoom or feature popup.
//   legend=1    show a legend of the layers in view.
//   view=fit    fit the camera to the map's content on load, and again when
//               the frame changes size, until the reader moves the map.
//   view=saved  open at the camera saved in the share: the view the author
//               had when they shared it.
//
// The view decision. Every saved map carries a camera, so a camera in the
// share is not a sign that the author chose one. The author's screen and the
// reader's frame have different sizes, too: a camera chosen on a wide screen
// cuts off the sides in a phone-sized iframe. So an embed (/embed) fits the
// content by default, and the author asks for their own view with
// view=saved (the Share dialog's "Start at" choice). The share page (/m) is
// a whole browser tab, where the saved view is what the author sent, so it
// opens at the saved view by default. A map with no content keeps the saved
// view in both.

import { computeSceneBounds } from "@atlasdraw/geo";

import type { LngLatBox, SceneShape, WorldFrame } from "@atlasdraw/geo";

import { appBase, toEmbedUrl } from "../routes";

import { computeFeatureCollectionBounds } from "./fitMapToContent";

import type { FeatureCollection } from "geojson";

import type { OverlayEntry } from "../state/document";

/** Where the viewer opens its camera. */
export type EmbedView = "fit" | "saved";

export interface EmbedOptions {
  /** Disable map pan and zoom for a fixed-camera presentation. */
  lock: boolean;
  /** Show a legend of the layers in view. */
  legend: boolean;
  view: EmbedView;
}

/** What goes around the map: a bare iframe embed, or a page of its own. */
export type ViewerChrome = "minimal" | "share";

export function parseEmbedOptions(
  search: string,
  chrome: ViewerChrome,
): EmbedOptions {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  return {
    lock: params.get("lock") === "1",
    legend: params.get("legend") === "1",
    view:
      view === "fit" || view === "saved"
        ? view
        : chrome === "minimal"
        ? "fit"
        : "saved",
  };
}

/** What the Share dialog lets the author choose for an embed. */
export interface EmbedChoices {
  legend: boolean;
  view: EmbedView;
  /** A fixed height in CSS px, or null for a 16:10 box. */
  height: number | null;
}

/**
 * The embed URL for a share URL: the same map on `/embed`, with a query
 * string for each choice that is not the embed's default. A URL that is not
 * a share comes back unchanged.
 */
export function embedUrl(
  shareUrl: string,
  choices: EmbedChoices,
  base: string = appBase(),
): string {
  const url = toEmbedUrl(shareUrl, base);
  const params = new URLSearchParams();
  if (choices.legend) {
    params.set("legend", "1");
  }
  if (choices.view !== "fit") {
    params.set("view", choices.view);
  }
  const query = params.toString();
  if (url === shareUrl || !query) {
    return url;
  }
  const hashAt = url.indexOf("#");
  return hashAt < 0
    ? `${url}?${query}`
    : `${url.slice(0, hashAt)}?${query}${url.slice(hashAt)}`;
}

const escapeAttribute = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The `<iframe>` for a share URL. It takes the full width of the page's
 * column; its height comes from a 16:10 aspect ratio, so it fits a phone and
 * a wide article alike, or from the fixed height the author typed.
 */
export function embedSnippet(
  shareUrl: string,
  choices: EmbedChoices,
  base: string = appBase(),
): string {
  const size =
    choices.height === null
      ? "width:100%;aspect-ratio:16 / 10"
      : `width:100%;height:${choices.height}px`;
  const src = escapeAttribute(embedUrl(shareUrl, choices, base));
  return `<iframe src="${src}" style="${size};border:0;border-radius:8px" loading="lazy" allowfullscreen title="Atlasdraw map"></iframe>`;
}

/** The parts of a document that hold content with a place on the map. */
export interface ContentSource {
  world: WorldFrame;
  overlays: readonly OverlayEntry[];
  featureCollections: Readonly<Record<string, FeatureCollection>>;
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

/**
 * The lng/lat box of everything the map shows: the drawing, each visible
 * data layer's features and each visible raster's corners. Tile layers cover
 * the world and have no box. Null when there is nothing.
 */
export function contentBox(
  doc: ContentSource,
  elements: ReadonlyArray<SceneShape & { readonly isDeleted?: boolean }>,
): LngLatBox | null {
  let box = computeSceneBounds(elements, doc.world);
  for (const entry of doc.overlays) {
    if (!entry.visible) {
      continue;
    }
    if (entry.kind === "data") {
      const fc = doc.featureCollections[entry.id];
      box = union(box, fc ? computeFeatureCollectionBounds(fc) : null);
    } else if (entry.kind === "raster") {
      const lngs = entry.corners.map((c) => c[0]);
      const lats = entry.corners.map((c) => c[1]);
      box = union(box, {
        west: Math.min(...lngs),
        east: Math.max(...lngs),
        south: Math.min(...lats),
        north: Math.max(...lats),
      });
    }
  }
  return box;
}
