// SPDX-License-Identifier: MIT
// packages/data/src/geoxml.ts
// KML, KMZ and GPX → GeoJSON FeatureCollection.
//
// Pure module: bytes in, FeatureCollection out. @tmcw/togeojson
// (BSD-2-Clause) does the conversion. This module adds:
//   - XML parse with the global DOMParser, and errors that tell the user
//     what to fix;
//   - KML folders flattened, with the folder path in a `folder` property;
//   - KML bool fields read as the KML spec says ("false" and "0" are false);
//   - a count of features that cannot show on the map (no geometry, or a
//     KML GroundOverlay, which is an image);
//   - KMZ extraction with JSZip.
//
// The output can mix geometry kinds. Use `splitByGeometryKind` from
// ./geojson to make one layer per kind.

import { gpx, kmlWithFolders } from "@tmcw/togeojson";
import JSZip from "jszip";

import { DOMParser as XmlDomParser } from "@xmldom/xmldom";

import type { F, Folder } from "@tmcw/togeojson";
import type { Feature, FeatureCollection } from "geojson";

/** The file format that a `GeoXmlParseError` is about. */
export type GeoXmlFormat = "KML" | "KMZ" | "GPX";

/** Machine-readable failure modes for the KML, KMZ and GPX parsers. */
export type GeoXmlParseErrorCode =
  | "MALFORMED_XML" //   the text is not well-formed XML
  | "WRONG_FORMAT" //    well-formed XML, but not the format that was asked for
  | "NO_FEATURES" //     no feature in the file has coordinates
  | "BAD_ZIP" //         KMZ bytes are not a readable zip archive
  | "NO_KML_IN_KMZ"; //  the zip archive holds no .kml file

/**
 * Error type for KML, KMZ and GPX parse failures. `code` is the failure mode.
 * `format` is the format that the caller asked for. The message tells the
 * user what to do.
 */
export class GeoXmlParseError extends Error {
  readonly code: GeoXmlParseErrorCode;
  readonly format: GeoXmlFormat;
  constructor(
    format: GeoXmlFormat,
    code: GeoXmlParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeoXmlParseError";
    this.format = format;
    this.code = code;
  }
}

/** The result of a KML, KMZ or GPX parse. */
export interface GeoXmlImport {
  /** Features with a geometry. Geometry kinds can be mixed. */
  fc: FeatureCollection;
  /** Features in the file that are not in `fc`, because they cannot show. */
  droppedCount: number;
}

/** The name of the property that holds a KML feature's folder path. */
export const KML_FOLDER_PROPERTY = "folder";

/** The separator between folder names in the folder path. */
const FOLDER_SEPARATOR = " / ";

/**
 * Parse a GPX file. Waypoints become Points, routes become LineStrings and
 * tracks become LineStrings, or MultiLineStrings when a track has more than
 * one segment. Names, descriptions and times stay as properties.
 */
export async function parseGPX(blob: Blob): Promise<GeoXmlImport> {
  const doc = parseXml(await blob.text(), "GPX");
  requireRoot(doc, "GPX");
  return keepDrawable(gpx(doc).features, "GPX");
}

/**
 * Parse a KML file. Folders are flattened: each feature in a folder gets a
 * `folder` property with the folder path, for example "Parks / Trails". A
 * `folder` property that the file sets itself is kept.
 */
export async function parseKML(blob: Blob): Promise<GeoXmlImport> {
  return parseKmlText(await blob.text(), "KML");
}

/**
 * Parse a KMZ file: a zip archive that holds a KML file. The parser reads
 * `doc.kml` at the root of the archive. If there is no `doc.kml`, it reads
 * the first `.kml` file in the archive. Images and other files are ignored.
 */
export async function parseKMZ(blob: Blob): Promise<GeoXmlImport> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await blob.arrayBuffer());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new GeoXmlParseError(
      "KMZ",
      "BAD_ZIP",
      `The file is not a readable KMZ (zip) archive: ${detail}. ` +
        `Export it again, or unzip it and import the .kml file inside.`,
    );
  }
  const kmlEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".kml"),
  );
  const entry =
    kmlEntries.find((e) => e.name.toLowerCase() === "doc.kml") ?? kmlEntries[0];
  if (!entry) {
    throw new GeoXmlParseError(
      "KMZ",
      "NO_KML_IN_KMZ",
      "The KMZ archive holds no .kml file. A KMZ must contain a KML " +
        "document, usually named doc.kml.",
    );
  }
  return parseKmlText(await entry.async("string"), "KMZ");
}

// ---------------------------------------------------------------------------
// internal

function parseKmlText(text: string, format: "KML" | "KMZ"): GeoXmlImport {
  const doc = parseXml(text, format);
  requireRoot(doc, "KML", format);
  readBoolFieldsAsKml(doc);
  const features: F[] = [];
  flattenFolders(kmlWithFolders(doc).children, [], features);
  return keepDrawable(features, format);
}

/** KML's text for a false bool: "false" or "0" (KML 2.2, xsd:boolean). */
const KML_FALSE = /^\s*(false|0)\s*$/;

/**
 * togeojson reads a `bool` SimpleField with `Boolean(text)`, so "false" and
 * "0" become true. It reads empty text as false. Empty the text of every
 * false value of a bool field before togeojson reads the document.
 */
function readBoolFieldsAsKml(doc: Document): void {
  const boolFields = new Set(
    Array.from(doc.getElementsByTagName("SimpleField"))
      .filter((field) => field.getAttribute("type") === "bool")
      .map((field) => field.getAttribute("name") ?? ""),
  );
  if (boolFields.size === 0) {
    return;
  }
  for (const data of Array.from(doc.getElementsByTagName("SimpleData"))) {
    if (
      boolFields.has(data.getAttribute("name") ?? "") &&
      KML_FALSE.test(data.textContent ?? "")
    ) {
      data.textContent = "";
    }
  }
}

function flattenFolders(
  children: Array<Folder | F>,
  path: string[],
  out: F[],
): void {
  for (const child of children) {
    if (child.type === "folder") {
      const name = child.meta.name;
      const next =
        typeof name === "string" && name.trim() !== ""
          ? [...path, name.trim()]
          : path;
      flattenFolders(child.children, next, out);
      continue;
    }
    const properties = child.properties ?? {};
    if (path.length > 0 && !(KML_FOLDER_PROPERTY in properties)) {
      out.push({
        ...child,
        properties: {
          ...properties,
          [KML_FOLDER_PROPERTY]: path.join(FOLDER_SEPARATOR),
        },
      });
    } else {
      out.push(child);
    }
  }
}

/**
 * Remove the features that cannot show on the map, and count them: features
 * with no geometry, and KML GroundOverlays. togeojson gives a GroundOverlay
 * as a Polygon around the image; drawn as an area it would cover the map
 * with an empty box.
 */
function keepDrawable(
  features: Array<Feature | F>,
  format: GeoXmlFormat,
): GeoXmlImport {
  const kept: Feature[] = [];
  for (const f of features) {
    if (
      f.geometry !== null &&
      f.properties?.["@geometry-type"] !== "groundoverlay"
    ) {
      kept.push(f as Feature);
    }
  }
  if (kept.length === 0) {
    throw new GeoXmlParseError(
      format,
      "NO_FEATURES",
      format === "GPX"
        ? "The GPX file has no waypoints, routes or tracks with coordinates."
        : "The KML has no placemarks with coordinates. Network links, " +
          "overlays and styles alone do not import.",
    );
  }
  return {
    fc: { type: "FeatureCollection", features: kept },
    droppedCount: features.length - kept.length,
  };
}

function parseXml(text: string, format: GeoXmlFormat): Document {
  const malformed = (detail: string) =>
    new GeoXmlParseError(
      format,
      "MALFORMED_XML",
      `The file is not well-formed XML${detail ? ` (${detail})` : ""}. ` +
        `Repair the file, or export it again from the program that made it.`,
    );
  // A browser page has DOMParser. A Web Worker (where import runs) and Node
  // do not, so they use xmldom, which togeojson also accepts.
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const error = doc.getElementsByTagName("parsererror")[0];
    if (error) {
      throw malformed((error.textContent ?? "").trim().split("\n")[0]);
    }
    return doc;
  }
  // xmldom reports an unclosed tag only as a warning; a browser refuses the
  // file. Refuse it here too, so both paths agree.
  let problem: string | null = null;
  const doc = new XmlDomParser({
    errorHandler: {
      warning: (msg: string) => {
        problem ??= msg;
      },
      error: (msg: string) => {
        problem ??= msg;
      },
      fatalError: (msg: string) => {
        problem ??= msg;
      },
    },
  }).parseFromString(text, "application/xml");
  if (problem !== null || !doc.documentElement) {
    const detail = String(problem ?? "")
      .replace(/^\[xmldom \w+\]\s*/, "")
      .trim()
      .split("\n")[0];
    throw malformed(detail);
  }
  return doc as unknown as Document;
}

/** Make sure that the root element is `<kml>` or `<gpx>`. */
function requireRoot(
  doc: Document,
  expected: "KML" | "GPX",
  format: GeoXmlFormat = expected,
): void {
  const root = (doc.documentElement?.localName ?? "").toLowerCase();
  if (root === expected.toLowerCase()) {
    return;
  }
  const hint =
    root === "gpx"
      ? " It is a GPX file: rename it to .gpx and import it again."
      : root === "kml"
      ? " It is a KML file: rename it to .kml and import it again."
      : "";
  throw new GeoXmlParseError(
    format,
    "WRONG_FORMAT",
    `Expected a <${expected.toLowerCase()}> root element, got <${root}>.${hint}`,
  );
}
