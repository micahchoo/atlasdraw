// SPDX-License-Identifier: AGPL-3.0-only
//
// XYZ tile layers: map tiles from a URL template, such as aerial
// imagery or a scanned historic map served as tiles.
//
//   validateTileTemplate(text)    the template the editor accepts, or the
//                                 reason it refuses it
//   creditLine(basemap, overlays) the basemap's credit and the credit of
//                                 each visible tile layer, for the status
//                                 bar and the exports
//
// The editor makes no call to a tile server until the user adds a layer, and
// it ships no tile URL and no key: the person who adds a layer chooses the
// server. https is required so that a map page served over https does not
// load mixed content; a server on this computer (localhost) may use http,
// which is how an operator tests a local tile server.

import type { OverlayEntry } from "../state/document";

export type TileTemplateCheck =
  | { ok: true; url: string }
  | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateTileTemplate(text: string): TileTemplateCheck {
  const url = text.trim();
  let parsed: URL;
  try {
    // The braces are not valid in a host name; fill them in to parse.
    parsed = new URL(url.replace(/\{[a-z]\}/g, "0"));
  } catch {
    return {
      ok: false,
      reason: "Type a web address that starts with https://.",
    };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      reason: "Type a web address that starts with https://.",
    };
  }
  if (parsed.protocol === "http:" && !LOCAL_HOSTS.has(parsed.hostname)) {
    return {
      ok: false,
      reason:
        "Use https. Only a server on this computer (localhost) can use http.",
    };
  }
  if (url.includes("{s}")) {
    return {
      ok: false,
      reason: "Replace {s} with one server name, for example a.",
    };
  }
  if (!["{z}", "{x}", "{y}"].every((p) => url.includes(p))) {
    return { ok: false, reason: "The URL must contain {z}, {x} and {y}." };
  }
  return { ok: true, url };
}

/**
 * The credit line: the basemap's credit, then the credit of each visible
 * tile layer, top of the stack first, each one once.
 */
export function creditLine(
  basemap: string | undefined,
  overlays: readonly OverlayEntry[],
): string {
  const credits: string[] = [];
  const add = (text: string | undefined) => {
    const credit = text?.trim();
    if (credit && !credits.includes(credit)) {
      credits.push(credit);
    }
  };
  add(basemap);
  overlays
    .filter((e) => e.kind === "tile" && e.visible)
    .slice()
    .sort((a, b) => b.order - a.order)
    .forEach((e) => add(e.kind === "tile" ? e.attribution : undefined));
  return credits.join(" · ");
}
