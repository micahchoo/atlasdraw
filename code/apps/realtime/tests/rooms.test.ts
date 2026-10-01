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

import { CLOSE, ROOM_SIZE, withRoomToken } from "@atlasdraw/protocol";

import { registerHealth } from "../src/health";
import { sqliteRoomStore, type RoomStore } from "../src/room-store";
import {
  registerRoomServer,
  roomLimitsFromEnv,
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
  closeReasons: string[];
}

/** A WebSocket that says it was forwarded for `ip` by a proxy. */
function forwardedFor(ip: string): typeof WebSocket {
  return class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { "x-forwarded-for": ip } });
    }
  } as unknown as typeof WebSocket;
}

function connect(
  relay: Relay,
  room: string,
  tok: string,
  socket: typeof WebSocket = WebSocket,
): Client {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(relay.url, room, doc, {
    disableBc: true,
    WebSocketPolyfill: withRoomToken(
      socket as unknown as typeof globalThis.WebSocket,
      tok,
    ),
  });
  const closeCodes: number[] = [];
  const closeReasons: string[] = [];
  provider.on("connection-close", (event: CloseEvent | null) => {
    if (event) {
      closeCodes.push(event.code);
      closeReasons.push(event.reason);
    }
  });
  const client = { doc, provider, closeCodes, closeReasons };
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
      outsider.closeCodes.includes(CLOSE.denied),
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
      squatter.closeCodes.includes(CLOSE.denied),
    );
  });

  it("refuses a socket whose first message is not a token", async () => {
    const relay = await startRelay(memoryStore());
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${relay.url}/${randomUUID()}`);
      ws.on("open", () => ws.send(new Uint8Array([0, 0, 1, 0])));
      ws.on("close", (c) => resolve(c));
    });
    expect(code).toBe(CLOSE.denied);
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
      b.closeCodes.includes(CLOSE.full),
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

  it("refuses a wrong token without reading the room's state", async () => {
    const store = memoryStore();
    const room = randomUUID();
    store.save(room, {
      verifier: "00".repeat(32),
      state: new Uint8Array(1 << 20),
    });
    let loads = 0;
    const counted: RoomStore = {
      ...store,
      load: (name) => {
        loads += 1;
        return store.load(name);
      },
    };
    const relay = await startRelay(counted);
    const outsider = connect(relay, room, token());
    await until("the outsider is denied", () =>
      outsider.closeCodes.includes(CLOSE.denied),
    );
    expect(loads).toBe(0);
  });

  it("answers an upgrade to a path that is not /yjs/ with 404", async () => {
    const relay = await startRelay(memoryStore());
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/elsewhere`);
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => resolve(-1));
    });
    expect(status).toBe(404);
  });

  it("refuses an update that would take the room past its cap, before it is in memory", async () => {
    const cap = 64 * 1024;
    const relay = await startRelay(memoryStore(), {
      maxRoomBytes: cap,
      saveDelayMs: 60_000,
    });
    const room = randomUUID();
    const tok = token();
    const a = connect(relay, room, tok);
    const b = connect(relay, room, tok);
    await until("both synced", () => a.provider.synced && b.provider.synced);

    a.doc.getMap("meta").set("first", "x".repeat(40 * 1024));
    await until("B sees the first value", () =>
      b.doc.getMap("meta").has("first"),
    );
    a.doc.getMap("meta").set("second", "y".repeat(40 * 1024));
    await until("A is closed as too large", () =>
      a.closeCodes.includes(CLOSE.roomTooLarge),
    );
    a.provider.destroy();
    expect(a.closeReasons.find((r) => r.startsWith("room too large"))).toMatch(
      new RegExp(`^room too large: \\d+ > ${cap}$`),
    );

    // The relay's copy never took the second value: a late joiner and B
    // both lack it, while B keeps the room open.
    const c = connect(relay, room, tok);
    await until("C is synced", () => c.provider.synced);
    expect(c.doc.getMap("meta").has("first")).toBe(true);
    expect(c.doc.getMap("meta").has("second")).toBe(false);
    expect(b.doc.getMap("meta").has("second")).toBe(false);
  });

  it("takes its default message and room caps from the protocol's size table", () => {
    const limits = roomLimitsFromEnv();
    expect(limits.maxMessageBytes).toBe(ROOM_SIZE.messageBytes);
    expect(limits.maxRoomBytes).toBe(ROOM_SIZE.roomBytes);
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

// ---------------------------------------------------------------------------
// Abuse limits (SECURITY.md row 14)
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A clock the test moves by hand. */
function clock(start = Date.UTC(2026, 9, 1)) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("abuse limits", () => {
  it("refuses a new room over the per-IP limit for the hour, and admits again after it", async () => {
    const time = clock();
    const relay = await startRelay(memoryStore(), {
      maxNewRoomsPerIp: 2,
      now: time.now,
    });
    const tok = token();
    const first = randomUUID();
    const a = connect(relay, first, tok);
    const b = connect(relay, randomUUID(), tok);
    await until(
      "two rooms are made",
      () => a.provider.synced && b.provider.synced,
    );

    const c = connect(relay, randomUUID(), tok);
    await until("the third new room is refused as limited", () =>
      c.closeCodes.includes(CLOSE.limited),
    );
    expect(c.closeReasons).toContain("too many new rooms");

    // Joining a room that exists makes no room, so it is not counted.
    const again = connect(relay, first, tok);
    await until(
      "a room that exists can still be joined",
      () => again.provider.synced,
    );

    time.advance(HOUR + 1);
    const d = connect(relay, randomUUID(), tok);
    await until("an hour later a new room is made", () => d.provider.synced);
  });

  it("reads the forwarded address only when a proxy is trusted", async () => {
    const tok = token();
    const untrusted = await startRelay(memoryStore(), { maxNewRoomsPerIp: 1 });
    const u1 = connect(
      untrusted,
      randomUUID(),
      tok,
      forwardedFor("203.0.113.1"),
    );
    await until("the first room is made", () => u1.provider.synced);
    const u2 = connect(
      untrusted,
      randomUUID(),
      tok,
      forwardedFor("203.0.113.2"),
    );
    await until("a forged header does not buy a second room", () =>
      u2.closeCodes.includes(CLOSE.limited),
    );

    const trusted = await startRelay(memoryStore(), {
      maxNewRoomsPerIp: 1,
      trustProxy: 1,
    });
    const t1 = connect(trusted, randomUUID(), tok, forwardedFor("203.0.113.1"));
    const t2 = connect(trusted, randomUUID(), tok, forwardedFor("203.0.113.2"));
    await until(
      "behind a trusted proxy each client address has its own limit",
      () => t1.provider.synced && t2.provider.synced,
    );
    const t3 = connect(trusted, randomUUID(), tok, forwardedFor("203.0.113.1"));
    await until("the same client address is still limited", () =>
      t3.closeCodes.includes(CLOSE.limited),
    );
  });

  it("refuses a connection over the per-IP limit, and admits one when another closes", async () => {
    const relay = await startRelay(memoryStore(), { maxConnectionsPerIp: 2 });
    const room = randomUUID();
    const tok = token();
    const a = connect(relay, room, tok);
    const b = connect(relay, room, tok);
    await until(
      "two connections are in",
      () => a.provider.synced && b.provider.synced,
    );

    const c = connect(relay, room, tok);
    await until("the third connection is refused as limited", () =>
      c.closeCodes.includes(CLOSE.limited),
    );
    expect(c.closeReasons).toContain("too many connections");
    expect(relay.rooms.connections()).toBe(2);

    leave(a);
    await until("the relay saw A go", () => relay.rooms.connections() === 1);
    const d = connect(relay, room, tok);
    await until("a new connection is admitted", () => d.provider.synced);
  });

  it("refuses a new room when the stored rooms reach the total cap", async () => {
    const store = memoryStore();
    const relay = await startRelay(store, { maxTotalBytes: 2000 });
    const tok = token();
    const a = connect(relay, randomUUID(), tok);
    a.doc.getMap("meta").set("title", "x".repeat(2500));
    await until("the big room is closed as out of space", () =>
      a.closeCodes.includes(CLOSE.noSpace),
    );
    expect(a.closeReasons).toContain("relay storage full");
    expect(store.totalBytes()).toBeLessThanOrEqual(2000);

    // A small room still fits.
    const small = randomUUID();
    const b = connect(relay, small, tok);
    b.doc.getMap("meta").set("title", "small");
    await until(
      "the small room is saved",
      () => (store.load(small)?.state.byteLength ?? 0) > 10,
    );

    const full = await startRelay(store, { maxTotalBytes: store.totalBytes() });
    const c = connect(full, randomUUID(), tok);
    await until("a new room on a full relay is refused", () =>
      c.closeCodes.includes(CLOSE.noSpace),
    );
    // A room that exists can still be opened and edited downward.
    const back = connect(full, small, tok);
    await until(
      "the existing room opens",
      () => back.doc.getMap("meta").get("title") === "small",
    );
  });

  it("deletes rooms nobody connected to for the expiry, at start and on the interval", async () => {
    const time = clock();
    const store = sqliteRoomStore(":memory:", { now: time.now });
    cleanups.push(() => store.close());
    const first = await startRelay(store, { now: time.now });
    const old = randomUUID();
    const tok = token();
    const a = connect(first, old, tok);
    a.doc.getMap("meta").set("title", "old survey");
    await until("A is synced", () => a.provider.synced);
    leave(a);
    await until("the room left memory", () => first.rooms.rooms() === 0);
    await first.stop();
    expect(store.load(old)).not.toBeNull();

    // At start.
    time.advance(91 * DAY);
    const second = await startRelay(store, {
      now: time.now,
      expireAfterMs: 90 * DAY,
      sweepIntervalMs: 50,
    });
    expect(store.load(old)).toBeNull();

    // On the interval, and never a room someone is in.
    const kept = randomUUID();
    const gone = randomUUID();
    const live = connect(second, kept, tok);
    const brief = connect(second, gone, tok);
    await until(
      "both synced",
      () => live.provider.synced && brief.provider.synced,
    );
    leave(brief);
    await until("the brief room left memory", () => second.rooms.rooms() === 1);
    time.advance(91 * DAY);
    await until(
      "the interval sweep deleted the empty room",
      () => store.load(gone) === null,
    );
    expect(store.load(kept)).not.toBeNull();

    // The id of a deleted room is free again: a new link makes a new room.
    const fresh = connect(second, old, token());
    await until(
      "a new token claims the expired id",
      () => fresh.provider.synced,
    );
    expect(fresh.doc.getMap("meta").get("title")).toBeUndefined();
  });
});
