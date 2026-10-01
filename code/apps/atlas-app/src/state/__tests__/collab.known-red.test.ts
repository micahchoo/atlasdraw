// @vitest-environment node
// The relay's own declaration for y-websocket's server helpers, which
// atlas-app's typecheck reaches through the relay import below.
/// <reference path="../../../../realtime/src/y-websocket-bin-utils.d.ts" />
// SPDX-License-Identifier: AGPL-3.0-only
//
// Collaboration, measured between two real clients through a real relay.
//
// Every test here opens real CollabState instances against the relay's own
// handlers (registerSocketIOHandlers + registerYjsHandler) on an ephemeral
// port. Nothing is mocked: socket.io-client, the y-websocket provider, the
// AES-GCM scene crypto and the relay are the production code.
//
// The `it.fails` tests state the CORRECT behaviour and fail on today's code
// (audit 02: F2, F5, F6 and the presence rows). They are the entry point for the
// W6 rebuild of collaboration on one Y.Doc per room: when W6 makes one pass,
// flip it to `it()`. The two plain `it` tests are controls. They pass today,
// and if one goes red, the harness or the relay broke and the known-red
// results below it mean nothing.
//
// THE HARNESS IS THE ONE PLACE W6 REWIRES. `openClient` binds a CollabState
// to a stand-in editor exactly as MapEditor.tsx binds it to Excalidraw, and
// no more: `setSceneAccessor` and `setSceneReceiver`. A local edit (`draw`)
// and a pointer move (`movePointer`) forward nothing to collaboration,
// because MapEditor forwards nothing. When W6 wires those paths in the app,
// change the harness to make the SAME calls MapEditor makes — never calls the
// app does not make, or a test goes green while the product stays broken.
//
// Two stores are module singletons (the document title and the data-layer
// FeatureCollections), so two React editors in one process would share them
// and "sync" through memory. That is why the data-layer and title tests write
// to the Y.Doc the app hooks write to (useYjsLayer, useCollabDocumentTitle)
// and not through the hooks.

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
import { Server as SocketIOServer } from "socket.io";

import {
  YjsLayer,
  addFeature,
  read as readAtlasdraw,
  toGeoJSON,
  write as writeAtlasdraw,
} from "@atlasdraw/data";
import { generateRoomKey } from "@atlasdraw/protocol";

import type {
  ExcalidrawElement,
  ExcalidrawImperativeAPI,
} from "@atlasdraw/excalidraw";

import { registerSocketIOHandlers } from "../../../../realtime/src/socket-io-server";
import { registerYjsHandler } from "../../../../realtime/src/yjs-server";
import { __resetAppConfigForTests } from "../../config/app-config";
import { META_MAP_KEY, TITLE_KEY } from "../../hooks/useCollabDocumentTitle";
import { CollabState } from "../collab";
import { selectDocument } from "../selectDocument";

import type * as Y from "yjs";

import type { LayerRegistryState } from "../layerRegistry";

// Short, so a test can outlive it. The relay evicts a room's Yjs doc this
// long after its last client leaves.
const ROOM_TTL_MS = 200;

let server: http.Server;
let io: SocketIOServer;
let yjs: { close(): void };
let port: number;

beforeAll(async () => {
  server = http.createServer();
  io = new SocketIOServer(server, { transports: ["websocket"] });
  registerSocketIOHandlers(io);
  yjs = registerYjsHandler(server, { roomTtlMs: ROOM_TTL_MS });
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
  vi.stubEnv("VITE_BUILD_TARGET", "hosted");
  vi.stubEnv("VITE_REALTIME_ENABLED", "true");
}, 10_000);

afterEach(() => {
  // A failing test stops before its own leave().
  for (const c of open) {
    c.leave();
  }
});

afterAll(async () => {
  yjs.close();
  await io.close(); // also closes `server`
  vi.unstubAllEnvs();
  __resetAppConfigForTests();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Client {
  collab: CollabState;
  /** The stand-in editor's scene — what Excalidraw would be showing. */
  scene: ExcalidrawElement[];
  /** The owner draws an element. */
  draw(element: ExcalidrawElement): void;
  /** The owner moves the pointer over the canvas. */
  movePointer(x: number, y: number): void;
  leave(): void;
}

const open = new Set<Client>();

// Each client reaches the relay through its own loopback address, as if from
// its own machine. y-websocket providers in ONE process otherwise sync
// through lib0's in-memory broadcast channel, keyed by server URL and room,
// and a comments test would pass without the relay carrying anything.
let machine = 0;

function openClient(roomId: string, key: CryptoKey): Client {
  machine = (machine % 250) + 1;
  vi.stubEnv("VITE_REALTIME_WS_URL", `http://127.0.0.${machine}:${port}`);
  __resetAppConfigForTests();

  const collab = new CollabState();
  const client: Client = {
    collab,
    scene: [],
    draw(element) {
      // Excalidraw replaces its element array. MapEditor's onChange
      // (useExcalidrawChangeHandler) sends nothing to CollabState.
      client.scene = [...client.scene, element];
    },
    movePointer() {
      // MapEditor registers no pointer handler that reaches CollabState.
    },
    leave() {
      collab.disconnect();
      open.delete(client);
    },
  };
  // MapEditor.tsx, the effect after useCollabRoom: these two calls are the
  // whole binding between the editor and collaboration.
  collab.setSceneAccessor(() => client.scene);
  collab.setSceneReceiver((elements) => {
    client.scene = elements;
  });
  collab.connect(roomId, key);
  open.add(client);
  return client;
}

/** Wait until the relay counts `n` sockets in the Socket.IO room. */
async function joined(roomId: string, n: number): Promise<void> {
  await until(
    `relay counts ${n} socket(s) in the room`,
    () => io.sockets.adapter.rooms.get(roomId)?.size === n,
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

function settle(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function doc(c: Client): Y.Doc {
  const d = c.collab.yjsDoc;
  if (!d) {
    throw new Error("client has no Y.Doc after connect()");
  }
  return d;
}

/** Comment texts this client can see. */
function commentTexts(c: Client): string[] {
  return (c.collab.commentsLayer?.comments ?? []).map((x) => x.text);
}

function addComment(c: Client, text: string): void {
  const layer = c.collab.commentsLayer;
  if (!layer) {
    throw new Error("client has no comments layer after connect()");
  }
  layer.addComment({
    text,
    anchor: { kind: "map", lng: 13.4, lat: 52.5 },
    authorId: "author-a",
    authorName: "A",
  });
}

// ---------------------------------------------------------------------------
// Controls — these pass today
// ---------------------------------------------------------------------------

describe("controls: the harness and relay work", () => {
  it("a joiner receives the host's scene when it joins", async () => {
    const { roomId, key } = await generateRoomKey();
    const host = openClient(roomId, key);
    await joined(roomId, 1);
    host.draw(rectangle("before-join"));

    const guest = openClient(roomId, key);
    await until("the guest's scene holds the host's shape", () =>
      guest.scene.some((e) => e.id === "before-join"),
    );

    host.leave();
    guest.leave();
  });

  it("a comment one client adds reaches the other", async () => {
    const { roomId, key } = await generateRoomKey();
    const a = openClient(roomId, key);
    const b = openClient(roomId, key);
    await joined(roomId, 2);
    await settle(200);

    addComment(a, "live comment");
    await until("B sees A's comment", () =>
      commentTexts(b).includes("live comment"),
    );

    a.leave();
    b.leave();
  });
});

// ---------------------------------------------------------------------------
// Known-red
// ---------------------------------------------------------------------------

describe("collaboration between two clients", () => {
  // KNOWN-RED (W6 collaboration): a shape drawn after both clients joined never reaches the other client — nothing calls emitSceneUpdate and nothing sets onSceneUpdate, so only the one-time join snapshot ever crosses. Flip to it() when fixed.
  it.fails("a shape one client draws reaches the other", async () => {
    const { roomId, key } = await generateRoomKey();
    const a = openClient(roomId, key);
    const b = openClient(roomId, key);
    await joined(roomId, 2);
    // Let the join snapshot pull finish so it cannot carry the shape.
    await settle(500);

    a.draw(rectangle("drawn-after-join"));

    await until("B's scene holds the shape A drew", () =>
      b.scene.some((e) => e.id === "drawn-after-join"),
    );
    a.leave();
    b.leave();
  });

  // KNOWN-RED (W6 collaboration): a data-layer feature never leaves the client that adds it — YjsChannel opens a bare WebSocket to /yjs/<room> that never runs the Yjs sync protocol, so the data-layer Y.Doc reaches nobody. Flip to it() when fixed.
  it.fails(
    "a data-layer feature one client adds reaches the other",
    async () => {
      const { roomId, key } = await generateRoomKey();
      const a = openClient(roomId, key);
      const b = openClient(roomId, key);
      await joined(roomId, 2);
      await settle(200);

      // What useYjsLayer's `mutate.addFeature` does.
      const layer = new YjsLayer(doc(a)).getOrCreateLayer("default");
      addFeature(layer, "well-1", "Point", [[[13.4, 52.5]]], { name: "Well" });

      // Read-only on B: getOrCreateLayer here would race A's layer map.
      await until("B's data layer holds the feature A added", () => {
        const bLayer = doc(b).getMap("layers").get("default") as
          | Y.Map<Y.Map<unknown>>
          | undefined;
        return (
          bLayer !== undefined &&
          toGeoJSON(bLayer).features.some((f) => f.id === "well-1")
        );
      });
      a.leave();
      b.leave();
    },
  );

  // KNOWN-RED (W6 collaboration): clients never see each other — the peer list is filled only by CURSOR, no client emits CURSOR, and PEER_JOINED is ignored. Flip to it() when fixed.
  it.fails(
    "each client sees the other, with a cursor after it moves",
    async () => {
      const { roomId, key } = await generateRoomKey();
      const a = openClient(roomId, key);
      const b = openClient(roomId, key);
      await joined(roomId, 2);

      // Presence: each sees exactly one peer, without anyone moving.
      await until(
        "each client lists the other as a peer",
        () => a.collab.peers.size === 1 && b.collab.peers.size === 1,
      );

      a.movePointer(120, 80);
      b.movePointer(40, 300);

      await until("each peer carries a cursor", () =>
        [...a.collab.peers.values(), ...b.collab.peers.values()].every(
          (p) => p.cursor !== null,
        ),
      );
      a.leave();
      b.leave();
    },
  );

  // KNOWN-RED (W6 collaboration): the document title never leaves the client that sets it — it lives on the data-layer Y.Doc's `meta` map, and that doc is never synced (same bare WebSocket as the data layer). Flip to it() when fixed.
  it.fails("the document title one client sets reaches the other", async () => {
    const { roomId, key } = await generateRoomKey();
    const a = openClient(roomId, key);
    const b = openClient(roomId, key);
    await joined(roomId, 2);
    await settle(200);

    // What useCollabDocumentTitle does when the owner renames the sheet.
    doc(a).getMap<string>(META_MAP_KEY).set(TITLE_KEY, "Survey of the Spree");

    await until(
      "B's document title is the one A set",
      () =>
        doc(b).getMap<string>(META_MAP_KEY).get(TITLE_KEY) ===
        "Survey of the Spree",
    );
    a.leave();
    b.leave();
  });
});

describe("comments outlive the room", () => {
  // KNOWN-RED (W6 collaboration): comments live only in relay memory — once the last client leaves and the room TTL passes, the relay evicts the comments Y.Doc and the next visitor sees none. Flip to it() when fixed.
  it.fails(
    "comments survive the room emptying and refilling after the TTL",
    async () => {
      const { roomId, key } = await generateRoomKey();
      const a = openClient(roomId, key);
      const b = openClient(roomId, key);
      await joined(roomId, 2);
      await settle(200);

      addComment(a, "check the culvert");
      // B seeing it proves the relay holds it.
      await until("B sees A's comment", () =>
        commentTexts(b).includes("check the culvert"),
      );

      a.leave();
      b.leave();
      await settle(ROOM_TTL_MS * 4);

      const later = openClient(roomId, key);
      try {
        await until("a client joining the refilled room sees the comment", () =>
          commentTexts(later).includes("check the culvert"),
        );
      } finally {
        later.leave();
      }
    },
  );
});

describe("comments in the saved document", () => {
  const api = (elements: ExcalidrawElement[]) =>
    ({
      getSceneElements: () => elements,
      getAppState: () => ({}),
      getFiles: () => ({}),
    } as unknown as ExcalidrawImperativeAPI);

  const registry = { entries: [] } as unknown as LayerRegistryState;

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

  // KNOWN-RED (W6 collaboration): comments are not part of the saved .atlasdraw document — selectDocument reads the scene, layers, rasters and title, never the comments layer, so a save and reopen loses every comment. Flip to it() when fixed.
  it.fails(
    "a comment in the session is in the .atlasdraw file and comes back on read",
    async () => {
      const { roomId, key } = await generateRoomKey();
      const a = openClient(roomId, key);
      try {
        addComment(a, "survey marker is 2 m east");
        expect(commentTexts(a)).toContain("survey marker is 2 m east");

        const saved = selectDocument(api(a.scene), registry, {
          fcMap: {},
          rasterImages: {},
          title: "Saved map",
        });
        const reopened = await readAtlasdraw(await writeAtlasdraw(saved));

        expect(
          await mentions(reopened, "survey marker is 2 m east"),
          "the reopened document mentions the comment",
        ).toBe(true);
      } finally {
        a.leave();
      }
    },
  );
});
