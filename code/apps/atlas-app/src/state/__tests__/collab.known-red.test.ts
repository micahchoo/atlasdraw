// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Collaboration, measured between real clients through a real relay.
//
// Every test opens rooms (state/room.ts) against the relay's own room server
// (apps/realtime/src/rooms.ts) on an ephemeral port, over real WebSockets
// with the y-websocket provider. Nothing is mocked.
//
// THE HARNESS DOES ONLY WHAT THE EDITOR DOES (hooks/useRoom.ts and
// MapEditor.tsx): join with the link, attach the editor once the room has
// joined, and from then on make every edit through the room's Document, its
// comments, and `presence`. The stand-in editor plays Excalidraw: it holds
// the elements, and it calls its change listeners after a local edit, as
// Excalidraw's onChange does.
//
// BroadcastChannel is off in every provider, so nothing syncs around the
// relay.

import http from "http";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import {
  read as readAtlasdraw,
  write as writeAtlasdraw,
} from "@atlasdraw/data";
import {
  newRoomLink,
  roomToken,
  withRoomToken,
  type RoomLink,
} from "@atlasdraw/protocol";

import type { BinaryFileData } from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { sqliteRoomStore } from "../../../../realtime/src/room-store";
import {
  registerRoomServer,
  type RoomServer,
  type RoomServerOptions,
} from "../../../../realtime/src/rooms";
import { createDocument, type Document } from "../document";
import { planSeed } from "../roomDocument";
import { toFile } from "../documentIO";
import { joinRoom, relayTransport, type Room, type RoomStatus } from "../room";

import type { BinaryFiles, RoomEditor } from "../roomScene";
import type { FeatureCollection } from "geojson";

let server: http.Server;
let rooms: RoomServer;
let relayUrl: string;
const store = sqliteRoomStore(":memory:");

beforeAll(async () => {
  server = http.createServer();
  rooms = registerRoomServer(server, { store, saveDelayMs: 50 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  relayUrl = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 10_000);

afterEach(() => {
  // A failing test stops before its own leave().
  for (const c of open) {
    c.leave();
  }
});

afterAll(async () => {
  rooms.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  store.close();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Client {
  room: Room;
  /** The stand-in editor's scene — what Excalidraw would be showing. */
  scene: ExcalidrawElement[];
  /** The owner draws an element. */
  draw(element: ExcalidrawElement): void;
  /** The owner moves the pointer over the map, to this place. */
  movePointer(lng: number, lat: number): void;
  leave(): void;
}

const open = new Set<Client>();

/** A drawing with nothing in it, for rooms that test only layers. */
const NO_SCENE = { elements: () => [], files: () => ({}) };

function openClient(link: RoomLink): Client {
  const changeListeners = new Set<() => void>();
  let files: BinaryFiles = {};
  const editor: RoomEditor = {
    elements: () => client.scene,
    files: () => files,
    apply: (elements) => {
      client.scene = [...elements];
    },
    addFiles: (added: BinaryFileData[]) => {
      files = { ...files };
      for (const f of added) {
        files[f.id] = f;
      }
    },
    onChange: (listener) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };

  const room = joinRoom(link, relayTransport(relayUrl), {
    scene: { elements: () => client.scene, files: () => files },
  });
  let detach: (() => void) | null = null;
  room.status((status) => {
    if (status === "joined" && !detach) {
      detach = room.attach(editor);
    }
  });

  const client: Client = {
    room,
    scene: [],
    draw(element) {
      client.scene = [...client.scene, element];
      for (const l of changeListeners) {
        l();
      }
    },
    movePointer(lng, lat) {
      room.presence.setCursor({ lng, lat });
    },
    leave() {
      detach?.();
      room.leave();
      open.delete(client);
    },
  };
  open.add(client);
  return client;
}

async function joined(...clients: Client[]): Promise<void> {
  await until("every client has joined its room", () =>
    clients.every((c) => c.room.document !== null),
  );
}

async function until(
  what: string,
  cond: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start <= timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(cond(), `not within ${timeoutMs}ms: ${what}`).toBe(true);
}

function rectangle(id: string): ExcalidrawElement {
  return {
    id,
    type: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
  } as unknown as ExcalidrawElement;
}

function documentOf(c: Client) {
  const d = c.room.document;
  if (!d) {
    throw new Error("client has not joined");
  }
  return d;
}

/** Comment texts this client can see. */
function commentTexts(c: Client): string[] {
  return (c.room.document?.comments.comments ?? []).map((x) => x.text);
}

function addComment(c: Client, text: string): void {
  documentOf(c).comments.addComment({
    text,
    anchor: { kind: "map", lng: 13.4, lat: 52.5 },
    authorId: "author-a",
    authorName: "A",
  });
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

describe("controls: the harness and relay work", () => {
  it("a joiner receives the host's scene when it joins", async () => {
    const link = newRoomLink();
    const host = openClient(link);
    await joined(host);
    host.draw(rectangle("before-join"));

    const guest = openClient(link);
    await until("the guest's scene holds the host's shape", () =>
      guest.scene.some((e) => e.id === "before-join"),
    );

    host.leave();
    guest.leave();
  });

  it("a comment one client adds reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    addComment(a, "live comment");
    await until("B sees A's comment", () =>
      commentTexts(b).includes("live comment"),
    );

    a.leave();
    b.leave();
  });

  it("a client whose link has another key for the room is denied and sees nothing", async () => {
    const link = newRoomLink();
    const owner = openClient(link);
    await joined(owner);
    addComment(owner, "for the team only");

    const outsider = openClient({ ...link, secret: newRoomLink().secret });
    const seen: string[] = [];
    outsider.room.status((s) => seen.push(s));
    await until("the outsider is denied", () => seen.includes("denied"));
    expect(outsider.room.document).toBeNull();

    owner.leave();
    outsider.leave();
  });
});

// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------

describe("collaboration between two clients", () => {
  it("a shape one client draws reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    a.draw(rectangle("drawn-after-join"));

    await until("B's scene holds the shape A drew", () =>
      b.scene.some((e) => e.id === "drawn-after-join"),
    );
    a.leave();
    b.leave();
  });

  it("a data-layer feature one client adds reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    // What the import path does: a command on the open document.
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "well-1",
          properties: { name: "Well" },
          geometry: { type: "Point", coordinates: [13.4, 52.5] },
        },
      ],
    };
    documentOf(a).dispatch({
      type: "add-data-layer",
      id: "dl:wells",
      fc,
      label: "Wells",
      style: {},
    });

    await until("B's data layer holds the feature A added", () =>
      (
        documentOf(b).snapshot().featureCollections["dl:wells"]?.features ?? []
      ).some((f) => f.id === "well-1"),
    );
    expect(
      documentOf(b)
        .snapshot()
        .overlays.map((e) => e.label),
    ).toEqual(["Wells"]);
    a.leave();
    b.leave();
  });

  it("each client sees the other, with a cursor after it moves", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    // Presence: each sees exactly one peer, without anyone moving.
    await until(
      "each client lists the other as a peer",
      () =>
        a.room.presence.peers().length === 1 &&
        b.room.presence.peers().length === 1,
    );

    a.movePointer(13.4, 52.5);
    b.movePointer(2.35, 48.85);

    await until("each peer carries a cursor", () =>
      [...a.room.presence.peers(), ...b.room.presence.peers()].every(
        (p) => p.cursor !== null,
      ),
    );
    expect(b.room.presence.peers()[0]?.cursor).toEqual({
      lng: 13.4,
      lat: 52.5,
    });
    a.leave();
    b.leave();
  });

  it("a display name one client sets reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    a.room.presence.setName("Ana from survey");

    await until("B lists A under the new name", () =>
      b.room.presence.peers().some((p) => p.user.name === "Ana from survey"),
    );
    expect(a.room.presence.self.name).toBe("Ana from survey");
    a.leave();
    b.leave();
  });

  it("the document title one client sets reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    // What the title field does when the owner renames the sheet.
    documentOf(a).dispatch({
      type: "rename-document",
      title: "Survey of the Spree",
    });

    await until(
      "B's document title is the one A set",
      () => documentOf(b).snapshot().title === "Survey of the Spree",
    );
    a.leave();
    b.leave();
  });

  it("the basemap one client chooses reaches the other", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    // What the Layers panel's basemap picker does.
    documentOf(a).dispatch({ type: "set-basemap", id: "protomaps-dark" });

    await until(
      "B's document has the basemap A chose",
      () => documentOf(b).snapshot().basemap === "protomaps-dark",
    );
    a.leave();
    b.leave();
  });
});

// ---------------------------------------------------------------------------
// A peer that writes what no honest client writes
// ---------------------------------------------------------------------------

/**
 * A peer that speaks the protocol with the link's token and writes straight
 * into the room doc, past every API of state/room.ts.
 */
interface Rogue {
  doc: Y.Doc;
  leave(): void;
}

const rogues = new Set<Rogue>();
afterEach(() => {
  for (const r of rogues) {
    r.leave();
  }
});

async function openRogue(link: RoomLink): Promise<Rogue> {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${relayUrl}/yjs`, link.roomId, doc, {
    disableBc: true,
    WebSocketPolyfill: withRoomToken(WebSocket, await roomToken(link)),
  });
  const rogue: Rogue = {
    doc,
    leave() {
      provider.destroy();
      doc.destroy();
      rogues.delete(rogue);
    },
  };
  rogues.add(rogue);
  await until("the rogue is synced", () => provider.synced);
  return rogue;
}

function writeRaw(rogue: Rogue, write: (doc: Y.Doc) => void): void {
  rogue.doc.transact(() => write(rogue.doc));
}

function textElement(id: string, text: string): ExcalidrawElement {
  return {
    ...rectangle(id),
    type: "text",
    text,
    originalText: text,
    fontSize: 20,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    lineHeight: 1.25,
    autoResize: true,
  } as unknown as ExcalidrawElement;
}

/** Elements a rogue writes: two valid (one to repair), the rest malformed. */
function writeMalformedElements(rogue: Rogue): void {
  writeRaw(rogue, (doc) => {
    const elements = doc.getMap<unknown>("elements");
    elements.set("ok", rectangle("ok"));
    elements.set("repair", {
      ...rectangle("repair"),
      strokeColor: { evil: true },
      opacity: "full",
    });
    elements.set("bad-type", { ...rectangle("bad-type"), type: "nonsense" });
    elements.set("bad-x", { ...rectangle("bad-x"), x: "10" });
    elements.set("nan-version", { ...rectangle("nan-version"), version: "1" });
    elements.set("huge", textElement("huge", "x".repeat(2_000_000)));
    elements.set("not-its-id", rectangle("someone-else"));
    elements.set("not-an-object", "hello");
    elements.set("bad-points", {
      ...rectangle("bad-points"),
      type: "line",
      points: [
        [0, 0],
        ["a", 1],
      ],
    });
  });
}

const sceneIds = (c: Client) => c.scene.map((e) => e.id).sort();

describe("what a peer writes is checked before it reaches the editor", () => {
  it("malformed elements are dropped, repairable ones repaired, and the editor keeps working", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const link = newRoomLink();
    const a = openClient(link);
    await joined(a);
    const rogue = await openRogue(link);

    writeMalformedElements(rogue);

    await until("A shows the valid elements", () =>
      ["ok", "repair"].every((id) => a.scene.some((e) => e.id === id)),
    );
    expect(sceneIds(a)).toEqual(["ok", "repair"]);
    const repaired = a.scene.find((e) => e.id === "repair")!;
    expect(typeof repaired.strokeColor).toBe("string");
    expect(typeof repaired.opacity).toBe("number");

    const fromRogue = warn.mock.calls.filter((args) =>
      String(args[0]).includes(`peer ${rogue.doc.clientID}`),
    );
    expect(fromRogue, "one warning per peer, not per record").toHaveLength(1);

    // A keeps working: its next shape reaches the room and a new joiner.
    a.draw(rectangle("after"));
    const b = openClient(link);
    await until("a new joiner receives A's next shape", () =>
      b.scene.some((e) => e.id === "after"),
    );
    warn.mockRestore();
    a.leave();
    b.leave();
  });

  it("a client that joins a room holding malformed elements shows the valid ones", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const link = newRoomLink();
    const rogue = await openRogue(link);
    writeMalformedElements(rogue);

    const late = openClient(link);
    await until("the late joiner shows the valid elements", () =>
      late.scene.some((e) => e.id === "ok"),
    );
    expect(sceneIds(late)).toEqual(["ok", "repair"]);
    vi.mocked(console.warn).mockRestore();
    late.leave();
  });

  it("malformed layers, features, images, title, basemap and comments are ignored", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const link = newRoomLink();
    const a = openClient(link);
    await joined(a);
    documentOf(a).dispatch({ type: "rename-document", title: "Survey" });
    const rogue = await openRogue(link);
    await until(
      "the rogue has A's title",
      () => rogue.doc.getMap("meta").get("title") === "Survey",
    );

    const goodFc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [13.4, 52.5] },
        },
      ],
    };
    const dataEntry = (id: string) => ({
      kind: "data",
      id,
      label: id,
      visible: true,
      order: 0,
      featureCount: 1,
      geometryKind: "circle",
      style: {},
    });
    writeRaw(rogue, (doc) => {
      const overlays = doc.getMap<unknown>("overlays");
      const features = doc.getMap<unknown>("features");
      const images = doc.getMap<unknown>("images");
      const meta = doc.getMap<unknown>("meta");
      overlays.set("dl:good", dataEntry("dl:good"));
      features.set("dl:good", goodFc);
      // A data layer whose features are not a FeatureCollection.
      overlays.set("dl:bad-fc", dataEntry("dl:bad-fc"));
      features.set("dl:bad-fc", { type: "FeatureCollection", features: "x" });
      // Coordinates that are not numbers.
      overlays.set("dl:bad-coords", dataEntry("dl:bad-coords"));
      features.set("dl:bad-coords", {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: ["13", null] },
          },
        ],
      });
      // An id without its kind's prefix, and a key that is not the id.
      overlays.set("layer-1", { ...dataEntry("layer-1") });
      overlays.set("dl:other-key", dataEntry("dl:not-the-key"));
      // A tile layer with a script URL, and a raster whose image is no image.
      overlays.set("tl:evil", {
        kind: "tile",
        id: "tl:evil",
        label: "Evil",
        visible: true,
        order: 0,
        opacity: 1,
        url: ["javascript", "alert(1)"].join(":"),
      });
      overlays.set("rl:fake", {
        kind: "raster",
        id: "rl:fake",
        label: "Fake",
        visible: true,
        order: 0,
        corners: [
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
        opacity: 1,
        imageKey: "fake.png",
      });
      images.set("rl:fake", { mimeType: "text/html", bytes: "<script>" });
      meta.set("title", 12345);
      meta.set("basemap", { id: "dark" });
      const comments = doc.getArray<unknown>("comments");
      const valid = new Y.Map<unknown>();
      const anchor = new Y.Map<unknown>();
      anchor.set("kind", "map");
      anchor.set("lng", 13.4);
      anchor.set("lat", 52.5);
      for (const [k, v] of Object.entries({
        id: "c-valid",
        authorId: "r",
        authorName: "R",
        text: "valid note",
        createdAt: 1,
        resolved: false,
        schemaVersion: 2,
      })) {
        valid.set(k, v);
      }
      valid.set("anchor", anchor);
      const wrong = new Y.Map<unknown>();
      wrong.set("id", "c-wrong");
      wrong.set("text", { not: "text" });
      comments.push(["just a string", wrong, valid]);
    });

    await until("A shows the valid comment", () =>
      commentTexts(a).includes("valid note"),
    );
    await until("A shows the valid layer", () =>
      documentOf(a)
        .snapshot()
        .overlays.some((e) => e.id === "dl:good"),
    );
    const state = documentOf(a).snapshot();
    expect(state.overlays.map((e) => e.id)).toEqual(["dl:good"]);
    expect(Object.keys(state.featureCollections)).toEqual(["dl:good"]);
    expect(state.title).toBe("Survey");
    expect(commentTexts(a)).toEqual(["valid note"]);

    // A keeps working, and its own edits do not delete what it ignored.
    addComment(a, "after the noise");
    await until("the rogue receives A's comment", () =>
      rogue.doc
        .getArray<unknown>("comments")
        .toArray()
        .some((m) => m instanceof Y.Map && m.get("text") === "after the noise"),
    );
    expect(rogue.doc.getMap("overlays").has("tl:evil")).toBe(true);
    expect(rogue.doc.getMap("overlays").has("dl:good")).toBe(true);
    vi.mocked(console.warn).mockRestore();
    a.leave();
  });
});

describe("the relay's abuse limits reach the user", () => {
  it("a client over the relay's new-room limit is told so and stops trying", async () => {
    const limitedServer = http.createServer();
    const limitedStore = sqliteRoomStore(":memory:");
    const limited = registerRoomServer(limitedServer, {
      store: limitedStore,
      maxNewRoomsPerIp: 1,
    });
    await new Promise<void>((resolve) => limitedServer.listen(0, resolve));
    const url = `ws://127.0.0.1:${
      (limitedServer.address() as { port: number }).port
    }`;
    try {
      const first = joinRoom(newRoomLink(), relayTransport(url));
      await until("the first room is made", () => first.document !== null);
      const second = joinRoom(newRoomLink(), relayTransport(url));
      const seen: string[] = [];
      second.status((s) => seen.push(s));
      await until("the second is refused as limited", () =>
        seen.includes("limited"),
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(seen.at(-1), "no retry turned it into another status").toBe(
        "limited",
      );
      expect(limited.connections()).toBe(1);
      first.leave();
      second.leave();
    } finally {
      limited.close();
      await new Promise<void>((resolve) => {
        limitedServer.close(() => resolve());
        limitedServer.closeAllConnections();
      });
      limitedStore.close();
    }
  });
});

describe("what a client skipped stays in the room", () => {
  it("a layer whose features this client cannot read survives this client's next edit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const link = newRoomLink();
    const a = openClient(link);
    await joined(a);
    const rogue = await openRogue(link);

    // What a newer client might write: a geometry this one does not know.
    writeRaw(rogue, (doc) => {
      doc.getMap<unknown>("overlays").set("dl:new", {
        kind: "data",
        id: "dl:new",
        label: "From a newer client",
        visible: true,
        order: 0,
        featureCount: 1,
        geometryKind: "circle",
        style: {},
      });
      doc.getMap<unknown>("features").set("dl:new", {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Curve", coordinates: [13.4, 52.5] },
          },
        ],
      });
    });
    await until("A has the rogue's write", () =>
      a.room.doc.getMap("overlays").has("dl:new"),
    );
    expect(documentOf(a).snapshot().overlays).toEqual([]);

    // An unrelated edit by A: toRoom diffs the whole Document.
    documentOf(a).dispatch({ type: "rename-document", title: "Renamed" });
    await until(
      "the rogue has A's rename",
      () => rogue.doc.getMap("meta").get("title") === "Renamed",
    );
    expect(rogue.doc.getMap("overlays").has("dl:new")).toBe(true);
    expect(rogue.doc.getMap("features").has("dl:new")).toBe(true);
    a.leave();
  });
});

describe("comments outlive the room", () => {
  it("comments survive the room emptying and refilling", async () => {
    const link = newRoomLink();
    const a = openClient(link);
    const b = openClient(link);
    await joined(a, b);

    addComment(a, "check the culvert");
    // B seeing it proves the relay holds it.
    await until("B sees A's comment", () =>
      commentTexts(b).includes("check the culvert"),
    );

    a.leave();
    b.leave();
    await until("the relay let the room go", () => rooms.rooms() === 0);

    const later = openClient(link);
    try {
      await until("a client joining the refilled room sees the comment", () =>
        commentTexts(later).includes("check the culvert"),
      );
    } finally {
      later.leave();
    }
  });
});

describe("comments in the saved document", () => {
  /** Whether `text` appears anywhere in a read-back document. */
  async function mentions(value: unknown, text: string): Promise<boolean> {
    if (typeof value === "string") {
      return value.includes(text);
    }
    if (value instanceof Blob) {
      return (await value.text()).includes(text);
    }
    if (value instanceof Map) {
      for (const [k, v] of value) {
        if ((await mentions(k, text)) || (await mentions(v, text))) {
          return true;
        }
      }
      return false;
    }
    if (value !== null && typeof value === "object") {
      for (const v of Object.values(value)) {
        if (await mentions(v, text)) {
          return true;
        }
      }
    }
    return false;
  }

  it("a comment in the session is in the .atlasdraw file and comes back on read", async () => {
    const a = openClient(newRoomLink());
    try {
      await joined(a);
      addComment(a, "survey marker is 2 m east");
      expect(commentTexts(a)).toContain("survey marker is 2 m east");

      // What Save does: the file form of the open document.
      const saved = toFile(documentOf(a));
      const reopened = await readAtlasdraw(await writeAtlasdraw(saved));

      expect(
        await mentions(reopened, "survey marker is 2 m east"),
        "the reopened document mentions the comment",
      ).toBe(true);
    } finally {
      a.leave();
    }
  });
});

// ---------------------------------------------------------------------------
// Size limits (protocol ROOM_SIZE): the relay refuses, the client says so
// ---------------------------------------------------------------------------

/** A relay of its own, with these limits, for one test. */
async function ownRelay(options: Partial<RoomServerOptions> = {}) {
  const ownServer = http.createServer();
  const ownStore = sqliteRoomStore(":memory:");
  const relay = registerRoomServer(ownServer, {
    store: ownStore,
    saveDelayMs: 50,
    ...options,
  });
  await new Promise<void>((resolve) => ownServer.listen(0, resolve));
  return {
    url: `ws://127.0.0.1:${(ownServer.address() as { port: number }).port}`,
    relay,
    async stop() {
      relay.close();
      await new Promise<void>((resolve) => {
        ownServer.close(() => resolve());
        ownServer.closeAllConnections();
      });
      ownStore.close();
    },
  };
}

const CORNERS: [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] = [
  [13.3, 52.6],
  [13.5, 52.6],
  [13.5, 52.4],
  [13.3, 52.4],
];

/** A PNG-typed image of `bytes` bytes, each one `fill`. */
function image(bytes: number, fill = 7): Blob {
  return new Blob([new Uint8Array(bytes).fill(fill)], { type: "image/png" });
}

function addRaster(d: Document, id: string, bytes: number): void {
  d.dispatch({
    type: "add-raster-layer",
    id,
    label: id,
    corners: CORNERS,
    imageKey: `${id}.png`,
    image: image(bytes),
  });
}

function statusesOf(room: Room): RoomStatus[] {
  const seen: RoomStatus[] = [];
  room.status((s) => seen.push(s));
  return seen;
}

describe("a room's size limits reach the user", () => {
  it("a map larger than one message is seeded in parts, and a joiner gets all of it", async () => {
    const seed = createDocument({ title: "Big survey" }, NO_SCENE);
    for (const id of ["rl:a", "rl:b", "rl:c"]) {
      addRaster(seed, id, 7 << 20);
    }
    const link = newRoomLink();
    const plan = await planSeed(seed, null);
    if (!plan.ok) {
      throw new Error(plan.reason);
    }
    const host = joinRoom(link, relayTransport(relayUrl), {
      seed: plan,
      scene: NO_SCENE,
    });
    try {
      await until("the host joined", () => host.document !== null, 20_000);
      const b = openClient(link);
      await until(
        "the joiner holds all three rasters",
        () =>
          (b.room.document?.snapshot().overlays.length ?? 0) === 3 &&
          Object.keys(b.room.document?.snapshot().images ?? {}).length === 3,
        20_000,
      );
      expect(b.room.document!.snapshot().title).toBe("Big survey");
      b.leave();
    } finally {
      host.leave();
    }
  }, 60_000);

  it("a change over the relay's message cap: the client says too large and stops trying", async () => {
    const own = await ownRelay({ maxMessageBytes: 64 * 1024 });
    try {
      const room = joinRoom(newRoomLink(), relayTransport(own.url), {
        scene: NO_SCENE,
      });
      const seen = statusesOf(room);
      await until("joined", () => room.document !== null);
      addRaster(room.document!, "rl:big", 100 * 1024);
      await until("the client is told the map is too large", () =>
        seen.includes("too-large"),
      );
      await new Promise((r) => setTimeout(r, 400));
      expect(seen.at(-1), "no retry turned it into another status").toBe(
        "too-large",
      );
      expect(own.relay.connections()).toBe(0);
      expect(room.reason).toMatch(/16\.0 MB/);
      room.leave();
    } finally {
      await own.stop();
    }
  });

  it("a change that takes the room past its cap: too large, with the relay's reason", async () => {
    const own = await ownRelay({ maxRoomBytes: 64 * 1024 });
    try {
      const room = joinRoom(newRoomLink(), relayTransport(own.url), {
        scene: NO_SCENE,
      });
      const seen = statusesOf(room);
      await until("joined", () => room.document !== null);
      addRaster(room.document!, "rl:one", 40 * 1024);
      await new Promise((r) => setTimeout(r, 200));
      addRaster(room.document!, "rl:two", 40 * 1024);
      await until("the client is told the map is too large", () =>
        seen.includes("too-large"),
      );
      expect(room.reason).toMatch(/64\.0 KB/);
      room.leave();
    } finally {
      await own.stop();
    }
  });
});
