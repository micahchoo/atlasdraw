// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — Phase 6 A9 workspace-namespaced room tests.
//
// JOIN_ROOM with `workspaceId` produces room key `${workspaceId}/${roomId}`,
// asserted via io.sockets.adapter.rooms (the truth source for room membership).
// JOIN_ROOM without `workspaceId` keeps the legacy single-tenant room key —
// so Phase 5 collab flows continue to work for self-host.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { io as ioc } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import { registerSocketIOHandlers } from "../src/socket-io-server";

let server: http.Server;
let io: SocketIOServer;
let port: number;

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioc(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    client.on("connect", () => resolve(client));
    client.on("connect_error", reject);
  });
}

async function joinRoom(
  client: ClientSocket,
  payload: { roomId: string; workspaceId?: string },
): Promise<void> {
  // The relay does not ack JOIN_ROOM — wait a short tick for the join to
  // propagate through Socket.IO's adapter.
  client.emit("JOIN_ROOM", payload);
  await new Promise((r) => setTimeout(r, 30));
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer();
    io = new SocketIOServer(server, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      transports: ["websocket"],
    });
    registerSocketIOHandlers(io);
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 10_000);

afterAll(() => {
  io.close();
  server.close();
});

describe("JOIN_ROOM workspace namespacing (Phase 6 A9)", () => {
  it("without workspaceId, room key equals roomId (legacy single-tenant)", async () => {
    const ROOM = "legacy-room-1";
    const client = await connectClient();
    await joinRoom(client, { roomId: ROOM });

    // Truth source: Socket.IO's adapter room map.
    const sockets = io.sockets.adapter.rooms.get(ROOM);
    expect(sockets).toBeDefined();
    expect(sockets!.size).toBe(1);
    // No namespaced key exists.
    expect(io.sockets.adapter.rooms.has(`ws-x/${ROOM}`)).toBe(false);

    client.disconnect();
  });

  it("with workspaceId, room key becomes ${workspaceId}/${roomId}", async () => {
    const WS = "ws-alpha";
    const ROOM = "room-with-ws";
    const client = await connectClient();
    await joinRoom(client, { roomId: ROOM, workspaceId: WS });

    const namespaced = io.sockets.adapter.rooms.get(`${WS}/${ROOM}`);
    expect(namespaced).toBeDefined();
    expect(namespaced!.size).toBe(1);
    // The un-namespaced key must NOT exist — that's the leakage we're
    // preventing.
    expect(io.sockets.adapter.rooms.has(ROOM)).toBe(false);

    client.disconnect();
  });

  it("two workspaces with the same baseRoomId are isolated", async () => {
    const ROOM = "shared-base";
    const a = await connectClient();
    const b = await connectClient();
    await joinRoom(a, { roomId: ROOM, workspaceId: "ws-a" });
    await joinRoom(b, { roomId: ROOM, workspaceId: "ws-b" });

    const ra = io.sockets.adapter.rooms.get(`ws-a/${ROOM}`);
    const rb = io.sockets.adapter.rooms.get(`ws-b/${ROOM}`);
    expect(ra?.size).toBe(1);
    expect(rb?.size).toBe(1);
    // No cross-leakage — keys are independent.
    expect([...(ra ?? [])][0]).not.toBe([...(rb ?? [])][0]);

    a.disconnect();
    b.disconnect();
  });

  it("empty-string workspaceId is treated as absent (no namespacing)", async () => {
    const ROOM = "empty-ws";
    const client = await connectClient();
    await joinRoom(client, { roomId: ROOM, workspaceId: "" });

    expect(io.sockets.adapter.rooms.get(ROOM)?.size).toBe(1);
    expect(io.sockets.adapter.rooms.has(`/${ROOM}`)).toBe(false);

    client.disconnect();
  });
});
