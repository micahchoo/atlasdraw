// SPDX-License-Identifier: AGPL-3.0-only
//
// The room server, measured with real y-websocket providers over real
// sockets. BroadcastChannel is off in every provider, so nothing syncs
// around the server.

import http from "http";
import { randomBytes, randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { withRoomToken } from "@atlasdraw/protocol";

import { registerHealth } from "../src/health";
import { sqliteRoomStore, type RoomStore } from "../src/room-store";
import {
  CLOSE_DENIED,
  CLOSE_FULL,
  registerRoomServer,
  type RoomServer,
  type RoomServerOptions,
} from "../src/rooms";

interface Relay {
  url: string;
  port: number;
  rooms: RoomServer;
  stop(): Promise<void>;
}

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

async function startRelay(
  store: RoomStore,
  options: Partial<RoomServerOptions> = {},
): Promise<Relay> {
  const server = http.createServer();
  const rooms = registerRoomServer(server, {
    store,
    saveDelayMs: 20,
    ...options,
  });
  registerHealth(server, rooms);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const relay: Relay = {
    url: `ws://127.0.0.1:${port}/yjs`,
    port,
    rooms,
    stop: () =>
      new Promise<void>((resolve) => {
        rooms.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
  cleanups.push(() => relay.stop());
  return relay;
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

interface Client {
  doc: Y.Doc;
  provider: WebsocketProvider;
  closeCodes: number[];
}

function connect(relay: Relay, room: string, tok: string): Client {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(relay.url, room, doc, {
    disableBc: true,
    WebSocketPolyfill: withRoomToken(
      WebSocket as unknown as typeof globalThis.WebSocket,
      tok,
    ),
  });
  const closeCodes: number[] = [];
  provider.on("connection-close", (event: CloseEvent | null) => {
    if (event) {
      closeCodes.push(event.code);
    }
  });
  const client = { doc, provider, closeCodes };
  cleanups.push(() => {
    provider.destroy();
    doc.destroy();
  });
  return client;
}

function leave(c: Client): void {
  c.provider.destroy();
}

async function until(what: string, cond: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(cond(), `not within ${ms}ms: ${what}`).toBe(true);
}

function memoryStore(): RoomStore {
  const store = sqliteRoomStore(":memory:");
  cleanups.push(() => store.close());
  return store;
}

describe("room server", () => {
  it("two clients with the link's token edit one doc", async () => {
    const relay = await startRelay(memoryStore());
    const room = randomUUID();
    const tok = token();
    const a = connect(relay, room, tok);
    const b = connect(relay, room, tok);

    a.doc.getMap("meta").set("title", "Spree survey");
    await until(
      "B sees A's title",
      () => b.doc.getMap("meta").get("title") === "Spree survey",
    );
    b.doc.getMap("meta").set("basemap", "dark");
    await until(
      "A sees B's basemap",
      () => a.doc.getMap("meta").get("basemap") === "dark",
    );
  });

  it("refuses a client whose token is not the room's, and sends it nothing", async () => {
    const relay = await startRelay(memoryStore());
    const room = randomUUID();
    const owner = connect(relay, room, token());
    owner.doc.getMap("meta").set("title", "secret");
    await until("the owner is synced", () => owner.provider.synced);

    const outsider = connect(relay, room, token());
    await until("the outsider is closed as denied", () =>
      outsider.closeCodes.includes(CLOSE_DENIED),
    );
    expect(outsider.doc.getMap("meta").get("title")).toBeUndefined();
  });

  it("keeps a room in memory while one client is still in it", async () => {
    const relay = await startRelay(memoryStore());
    const room = randomUUID();
    const tok = token();
    const a = connect(relay, room, tok);
    const b = connect(relay, room, tok);
    await until("both synced", () => a.provider.synced && b.provider.synced);

    leave(a);
    await new Promise((r) => setTimeout(r, 100));
    expect(relay.rooms.rooms()).toBe(1);

    b.doc.getMap("meta").set("title", "still here");
    const c = connect(relay, room, tok);
    await until(
      "a late joiner sees B's edit",
      () => c.doc.getMap("meta").get("title") === "still here",
    );
  });

  it("a room outlives its last client and a restart of the relay", async () => {
    const store = memoryStore();
    const first = await startRelay(store);
    const room = randomUUID();
    const tok = token();
    const a = connect(first, room, tok);
    a.doc.getArray("comments").push(["check the culvert"]);
    await until("the edit reached the relay", () => a.provider.synced);
    await new Promise((r) => setTimeout(r, 100));
    leave(a);
    await until("the room left memory", () => first.rooms.rooms() === 0);
    await first.stop();

    const second = await startRelay(store);
    const later = connect(second, room, tok);
    await until("the comment came back", () =>
      later.doc.getArray("comments").toArray().includes("check the culvert"),
    );
  });

  it("a restart does not free the room id for another token", async () => {
    const store = memoryStore();
    const first = await startRelay(store);
    const room = randomUUID();
    const a = connect(first, room, token());
    await until("A is synced", () => a.provider.synced);
    leave(a);
    await first.stop();

    const second = await startRelay(store);
    const squatter = connect(second, room, token());
    await until("the squatter is denied", () =>
      squatter.closeCodes.includes(CLOSE_DENIED),
    );
  });

  it("refuses a socket whose first message is not a token", async () => {
    const relay = await startRelay(memoryStore());
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${relay.url}/${randomUUID()}`);
      ws.on("open", () => ws.send(new Uint8Array([0, 0, 1, 0])));
      ws.on("close", (c) => resolve(c));
    });
    expect(code).toBe(CLOSE_DENIED);
    expect(relay.rooms.rooms()).toBe(0);
  });

  it("refuses a connection over the room's limit as full", async () => {
    const relay = await startRelay(memoryStore(), { maxPeersPerRoom: 1 });
    const room = randomUUID();
    const tok = token();
    const a = connect(relay, room, tok);
    await until("A is synced", () => a.provider.synced);
    const b = connect(relay, room, tok);
    await until("B is told the room is full", () =>
      b.closeCodes.includes(CLOSE_FULL),
    );
  });

  it("answers a path that is not a room id with 400 and opens no room", async () => {
    const relay = await startRelay(memoryStore());
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${relay.url}/comments/abc`);
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => resolve(-1));
    });
    expect(status).toBe(400);
    expect(relay.rooms.rooms()).toBe(0);
  });

  it("answers /health with the room and connection counts", async () => {
    const relay = await startRelay(memoryStore());
    const a = connect(relay, randomUUID(), token());
    await until("A is synced", () => a.provider.synced);
    const res = await fetch(`http://127.0.0.1:${relay.port}/health`);
    expect(await res.json()).toEqual({
      status: "ok",
      rooms: 1,
      connections: 1,
    });
  });
});
