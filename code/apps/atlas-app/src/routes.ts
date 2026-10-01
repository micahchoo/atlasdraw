// SPDX-License-Identifier: AGPL-3.0-only
//
// The app's routes: what a URL opens, and the URL for each thing the app
// links to. Every link the app makes comes from buildRoute, so every link
// works under the build's base path (`/atlasdraw/` on GitHub Pages).
//
//   <base>                    the editor
//   <base>#room:<id>,<secret> the editor, in a room (protocol/room-link.ts)
//   <base>#open:<shared>      the editor, with a copy of a shared map
//   <base>m#v2:<bytes>        the read-only viewer, map in the link
//   <base>m/<token>           the read-only viewer, map on the server
//   <base>embed…              the same two, without the viewer's chrome
//
// Any other path opens the editor. A `/m` link never joins a room.

import {
  parseRoomLink,
  roomFragment,
  type RoomLink,
} from "@atlasdraw/protocol";

/**
 * A shared map: the map's bytes in the link (`v1:` or `v2:`, without `#`),
 * or the server token that names them.
 */
export type SharedMap = { hash: string } | { token: string };

export type Route =
  | { kind: "editor"; room: RoomLink | null; open: SharedMap | null }
  /** The read-only viewer. `map` is null when the link is damaged. */
  | { kind: "share"; map: SharedMap | null }
  | { kind: "embed"; map: SharedMap | null };

const TOKEN = /^[A-Za-z0-9_-]{21}$/;
const OPEN = "open:";
const OPEN_TOKEN = "token:";

/** The base with one slash at each end: "" and "/" → "/". */
export function normalizeBase(base: string): string {
  const trimmed = base.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/** The base this build serves under. */
export function appBase(): string {
  return normalizeBase(import.meta.env.BASE_URL ?? "/");
}

function hashMap(fragment: string): SharedMap | null {
  return fragment.startsWith("v1:") || fragment.startsWith("v2:")
    ? { hash: fragment }
    : null;
}

/** A viewer's map: from the hash on `<page>`, or the token on `<page>/<t>`. */
function viewerMap(rest: string, page: string, hash: string): SharedMap | null {
  if (rest === page) {
    return hashMap(hash);
  }
  const token = rest.slice(page.length + 1).replace(/\/$/, "");
  return TOKEN.test(token) ? { token } : null;
}

function isPage(rest: string, page: string): boolean {
  return rest === page || rest.startsWith(`${page}/`);
}

/** What a location opens. `base` is the build's base path. */
export function parseRoute(
  location: { pathname: string; hash: string },
  base: string = appBase(),
): Route {
  const root = normalizeBase(base);
  const path = location.pathname;
  const hash = location.hash.startsWith("#")
    ? location.hash.slice(1)
    : location.hash;
  const rest = path.startsWith(root)
    ? path.slice(root.length)
    : `${path}/` === root
    ? ""
    : null;

  if (rest !== null && isPage(rest, "m")) {
    return { kind: "share", map: viewerMap(rest, "m", hash) };
  }
  if (rest !== null && isPage(rest, "embed")) {
    return { kind: "embed", map: viewerMap(rest, "embed", hash) };
  }
  let open: SharedMap | null = null;
  if (hash.startsWith(OPEN)) {
    const shared = hash.slice(OPEN.length);
    if (shared.startsWith(OPEN_TOKEN)) {
      const token = shared.slice(OPEN_TOKEN.length);
      open = TOKEN.test(token) ? { token } : null;
    } else {
      open = hashMap(shared);
    }
  }
  return { kind: "editor", room: parseRoomLink(hash), open };
}

function viewerPath(page: string, map: SharedMap | null): string {
  if (!map) {
    return page;
  }
  return "token" in map ? `${page}/${map.token}` : `${page}#${map.hash}`;
}

/** The path and fragment of a route, under `base`. */
export function buildRoute(route: Route, base: string = appBase()): string {
  const root = normalizeBase(base);
  switch (route.kind) {
    case "share":
      return `${root}${viewerPath("m", route.map)}`;
    case "embed":
      return `${root}${viewerPath("embed", route.map)}`;
    case "editor":
      if (route.room) {
        return `${root}${roomFragment(route.room)}`;
      }
      if (route.open) {
        return "token" in route.open
          ? `${root}#${OPEN}${OPEN_TOKEN}${route.open.token}`
          : `${root}#${OPEN}${route.open.hash}`;
      }
      return root;
  }
}

/** A route as a full URL on this page's origin. */
export function routeUrl(route: Route, base: string = appBase()): string {
  return `${window.location.origin}${buildRoute(route, base)}`;
}

/**
 * The embed URL for a share URL: the same map, on `/embed`. A URL that is
 * not a share comes back unchanged.
 */
export function toEmbedUrl(shareUrl: string, base: string = appBase()): string {
  const url = new URL(shareUrl);
  const route = parseRoute(url, base);
  if (route.kind !== "share" || !route.map) {
    return shareUrl;
  }
  return `${url.origin}${buildRoute({ kind: "embed", map: route.map }, base)}`;
}
