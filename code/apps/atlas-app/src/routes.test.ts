// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { roomFragment, type RoomLink } from "@atlasdraw/protocol";

import {
  buildRoute,
  normalizeBase,
  parseRoute,
  toEmbedUrl,
  type Route,
} from "./routes";

const TOKEN = "abcdefghij_klmnop-qrs";
const ROOM: RoomLink = {
  roomId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  secret: "A".repeat(43),
};

function at(pathname: string, hash = "", base = "/"): Route {
  return parseRoute({ pathname, hash }, base);
}

describe("normalizeBase", () => {
  it("gives a base with one slash at each end", () => {
    expect(normalizeBase("")).toBe("/");
    expect(normalizeBase("/")).toBe("/");
    expect(normalizeBase("/atlasdraw")).toBe("/atlasdraw/");
    expect(normalizeBase("atlasdraw/")).toBe("/atlasdraw/");
    expect(normalizeBase("/atlasdraw/")).toBe("/atlasdraw/");
  });
});

describe.each([
  ["no base", "/"],
  ["the Pages base", "/atlasdraw/"],
])("parseRoute with %s", (_, base) => {
  const p = (rest: string) => `${base}${rest}`;

  it("opens the editor at the base", () => {
    expect(at(base, "", base)).toEqual({
      kind: "editor",
      room: null,
      open: null,
    });
  });

  it("opens the editor at the base without its last slash", () => {
    expect(at(base.replace(/\/$/, "") || "/", "", base).kind).toBe("editor");
  });

  it("joins a room from a #room: link on the editor", () => {
    expect(at(base, roomFragment(ROOM), base)).toEqual({
      kind: "editor",
      room: ROOM,
      open: null,
    });
  });

  it("reads a hash share on /m", () => {
    expect(at(p("m"), "#v2:AAAA", base)).toEqual({
      kind: "share",
      map: { hash: "v2:AAAA" },
    });
    expect(at(p("m"), "#v1:BBBB", base)).toEqual({
      kind: "share",
      map: { hash: "v1:BBBB" },
    });
  });

  it("reads an upload share on /m/<token>", () => {
    expect(at(p(`m/${TOKEN}`), "", base)).toEqual({
      kind: "share",
      map: { token: TOKEN },
    });
  });

  it("keeps a bad /m link on the viewer, which says it is bad", () => {
    expect(at(p("m"), "#nonsense", base)).toEqual({ kind: "share", map: null });
    expect(at(p("m/short"), "", base)).toEqual({ kind: "share", map: null });
  });

  it("never joins a room from /m", () => {
    expect(at(p("m"), roomFragment(ROOM), base)).toEqual({
      kind: "share",
      map: null,
    });
  });

  it("reads /embed links of both kinds", () => {
    expect(at(p("embed"), "#v2:AAAA", base)).toEqual({
      kind: "embed",
      map: { hash: "v2:AAAA" },
    });
    expect(at(p(`embed/${TOKEN}`), "", base)).toEqual({
      kind: "embed",
      map: { token: TOKEN },
    });
  });

  it("opens a copy of a shared map in the editor", () => {
    expect(at(base, "#open:v2:AAAA", base)).toEqual({
      kind: "editor",
      room: null,
      open: { hash: "v2:AAAA" },
    });
    expect(at(base, `#open:token:${TOKEN}`, base)).toEqual({
      kind: "editor",
      room: null,
      open: { token: TOKEN },
    });
  });

  it("opens the editor for any other path", () => {
    expect(at(p("billing"), "", base).kind).toBe("editor");
  });

  it("round-trips every route through buildRoute", () => {
    const routes: Route[] = [
      { kind: "editor", room: null, open: null },
      { kind: "editor", room: ROOM, open: null },
      { kind: "editor", room: null, open: { hash: "v2:AAAA" } },
      { kind: "editor", room: null, open: { token: TOKEN } },
      { kind: "share", map: { hash: "v2:AAAA" } },
      { kind: "share", map: { token: TOKEN } },
      { kind: "embed", map: { hash: "v1:CCCC" } },
      { kind: "embed", map: { token: TOKEN } },
    ];
    for (const route of routes) {
      const href = buildRoute(route, base);
      expect(href.startsWith(base), href).toBe(true);
      const url = new URL(href, "https://maps.example");
      expect(at(url.pathname, url.hash, base)).toEqual(route);
    }
  });
});

describe("buildRoute", () => {
  it("puts every link under the base", () => {
    expect(buildRoute({ kind: "share", map: { hash: "v2:A" } }, "/")).toBe(
      "/m#v2:A",
    );
    expect(
      buildRoute({ kind: "share", map: { token: TOKEN } }, "/atlasdraw/"),
    ).toBe(`/atlasdraw/m/${TOKEN}`);
    expect(
      buildRoute({ kind: "editor", room: ROOM, open: null }, "/atlasdraw/"),
    ).toBe(`/atlasdraw/${roomFragment(ROOM)}`);
  });
});

describe("toEmbedUrl", () => {
  it("repoints a share URL at /embed, under the base", () => {
    expect(toEmbedUrl("https://x.test/m#v2:AAA", "/")).toBe(
      "https://x.test/embed#v2:AAA",
    );
    expect(
      toEmbedUrl(`https://x.test/atlasdraw/m/${TOKEN}`, "/atlasdraw/"),
    ).toBe(`https://x.test/atlasdraw/embed/${TOKEN}`);
  });

  it("gives back a URL that is not a share unchanged", () => {
    expect(toEmbedUrl("https://x.test/", "/")).toBe("https://x.test/");
  });
});
