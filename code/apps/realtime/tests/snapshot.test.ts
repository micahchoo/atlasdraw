// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — joiner-pull snapshot relay tests.
//
// Phase 5 Step 3 (atlasdraw plan 2026-05-15 § Step 3). Cites Q-P5-1: the relay
// elects the lexicographically-smallest socket.id remaining in the room to
// serve a snapshot, then routes the encrypted reply directly to the joiner
// (never broadcast). Tests cover election determinism, no-eligible-peer
// no-op, cross-room target rejection, malformed-payload drop, and the
// SCENE_UPDATE-equivalent size cap.

import http from "http";

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { Server as SocketIOServer } from "socket.io";
import { io as ioc } from "socket.io-client";

import { registerSocketIOHandlers } from "../src/socket-io-server";

import type { Socket as ClientSocket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Test server lifecycle
// ---------------------------------------------------------------------------

let server: http.Server;
let io: SocketIOServer;
let port: number;

function connectClient(): Promise<ClientSocket> {
  return new Promise<ClientSocket>((resolve, reject) => {
    const client = ioc(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    const timer = setTimeout(() => {
      reject(new Error("connectClient: timeout after 5s"));
    }, 5000);
    client.on("connect", () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.on("connect_error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Emit JOIN_ROOM and wait for the server adapter to commit the join.
 * Socket.IO v4 joins are async (await the adapter); 150 ms is plenty.
 */
function joinRoom(
  client: ClientSocket,
  roomId: string,
  settleMs = 150,
): Promise<void> {
  return new Promise<void>((resolve) => {
    client.emit("JOIN_ROOM", { roomId });
    setTimeout(resolve, settleMs);
  });
}

function roomSize(roomId: string): number {
  const s = io.sockets.adapter.rooms.get(roomId);
  return s ? s.size : 0;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer();
    io = new SocketIOServer(server, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      transports: ["websocket"],
      maxHttpBufferSize: 2 * 1024 * 1024,
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

// ---------------------------------------------------------------------------
// REQUEST_SNAPSHOT — election & routing
// ---------------------------------------------------------------------------

describe("REQUEST_SNAPSHOT (joiner-pull, Q-P5-1)", () => {
  it("with one existing peer: that peer receives the request; requester does not", async () => {
    const ROOM = "snap-one-peer";
    const peer = await connectClient();
    await joinRoom(peer, ROOM);

    const requester = await connectClient();
    await joinRoom(requester, ROOM);

    expect(roomSize(ROOM)).toBe(2);

    const peerReceived = new Promise<Record<string, unknown>>((resolve) => {
      peer.once("REQUEST_SNAPSHOT", (evt: Record<string, unknown>) =>
        resolve(evt),
      );
    });
    let requesterReceived = false;
    requester.on("REQUEST_SNAPSHOT", () => {
      requesterReceived = true;
    });

    requester.emit("REQUEST_SNAPSHOT", { roomId: ROOM });

    const evt = await peerReceived;
    expect(evt.roomId).toBe(ROOM);
    expect(typeof evt.senderId).toBe("string");
    expect(evt.senderId).toBe(requester.id);

    // Give some time to ensure requester did NOT also receive it.
    await new Promise((r) => setTimeout(r, 100));
    expect(requesterReceived).toBe(false);

    peer.close();
    requester.close();
  });

  it("with multiple peers: only the lowest socket.id peer receives the request", async () => {
    // Server's default MAX_ROOM_SIZE is 4 — pick 3 peers + 1 requester (4
    // total) to stay under the cap while still exercising the election.
    const ROOM = "snap-election";

    const peers: ClientSocket[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await connectClient();
      await joinRoom(c, ROOM);
      peers.push(c);
    }
    const requester = await connectClient();
    await joinRoom(requester, ROOM);

    expect(roomSize(ROOM)).toBe(4);

    // Lex-min socket.id among peers (requester is excluded by the handler).
    const peerIds = peers.map((p) => p.id!);
    const expectedWinner = [...peerIds].sort()[0];

    const receivers: string[] = [];
    for (const p of peers) {
      p.on("REQUEST_SNAPSHOT", () => {
        receivers.push(p.id!);
      });
    }
    requester.on("REQUEST_SNAPSHOT", () => {
      receivers.push(`REQUESTER:${requester.id}`);
    });

    requester.emit("REQUEST_SNAPSHOT", { roomId: ROOM });

    await new Promise((r) => setTimeout(r, 250));

    expect(receivers).toHaveLength(1);
    expect(receivers[0]).toBe(expectedWinner);

    requester.close();
    for (const c of peers) {
      c.close();
    }
  });

  it("with no other peers: relay does nothing (no error)", async () => {
    const ROOM = "snap-alone";
    const requester = await connectClient();
    await joinRoom(requester, ROOM);
    expect(roomSize(ROOM)).toBe(1);

    let selfReceived = false;
    requester.on("REQUEST_SNAPSHOT", () => {
      selfReceived = true;
    });

    requester.emit("REQUEST_SNAPSHOT", { roomId: ROOM });
    await new Promise((r) => setTimeout(r, 150));

    expect(selfReceived).toBe(false);
    // Connection still alive
    expect(requester.connected).toBe(true);

    requester.close();
  });

  it("with mismatched roomId: silently dropped", async () => {
    const ROOM_A = "snap-mismatch-a";
    const ROOM_B = "snap-mismatch-b";
    const peer = await connectClient();
    await joinRoom(peer, ROOM_B);

    const requester = await connectClient();
    await joinRoom(requester, ROOM_A);

    let received = false;
    peer.on("REQUEST_SNAPSHOT", () => {
      received = true;
    });

    // Requester (in ROOM_A) claims they want a snapshot from ROOM_B —
    // mismatch with their currentRoom, must be dropped.
    requester.emit("REQUEST_SNAPSHOT", { roomId: ROOM_B });
    await new Promise((r) => setTimeout(r, 150));

    expect(received).toBe(false);

    peer.close();
    requester.close();
  });
});

// ---------------------------------------------------------------------------
// SCENE_SNAPSHOT — direct routing, validation, no cross-room leakage
// ---------------------------------------------------------------------------

describe("SCENE_SNAPSHOT (encrypted reply, Q-P5-1)", () => {
  it("valid payload: only targetId receives the snapshot", async () => {
    const ROOM = "snap-direct";
    const sender = await connectClient();
    await joinRoom(sender, ROOM);
    const target = await connectClient();
    await joinRoom(target, ROOM);
    const bystander = await connectClient();
    await joinRoom(bystander, ROOM);

    const targetReceived = new Promise<Record<string, unknown>>((resolve) => {
      target.once("SCENE_SNAPSHOT", (evt: Record<string, unknown>) =>
        resolve(evt),
      );
    });
    let bystanderReceived = false;
    bystander.on("SCENE_SNAPSHOT", () => {
      bystanderReceived = true;
    });
    let senderEcho = false;
    sender.on("SCENE_SNAPSHOT", () => {
      senderEcho = true;
    });

    sender.emit("SCENE_SNAPSHOT", {
      roomId: ROOM,
      targetId: target.id,
      data: { iv: "aaaaaaaaaaaaaaaa", ciphertext: "Zm9vYmFy" },
    });

    const evt = await targetReceived;
    expect(evt.roomId).toBe(ROOM);
    expect(evt.targetId).toBe(target.id);
    expect((evt.data as { iv: string }).iv).toBe("aaaaaaaaaaaaaaaa");

    await new Promise((r) => setTimeout(r, 100));
    expect(bystanderReceived).toBe(false);
    expect(senderEcho).toBe(false);

    sender.close();
    target.close();
    bystander.close();
  });

  it("targetId not in the same room: dropped (no cross-room leakage)", async () => {
    const ROOM_A = "snap-leak-a";
    const ROOM_B = "snap-leak-b";
    const sender = await connectClient();
    await joinRoom(sender, ROOM_A);
    const outsider = await connectClient();
    await joinRoom(outsider, ROOM_B);

    let outsiderReceived = false;
    outsider.on("SCENE_SNAPSHOT", () => {
      outsiderReceived = true;
    });

    sender.emit("SCENE_SNAPSHOT", {
      roomId: ROOM_A,
      targetId: outsider.id,
      data: { iv: "aaaaaaaaaaaaaaaa", ciphertext: "Zm9vYmFy" },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(outsiderReceived).toBe(false);

    sender.close();
    outsider.close();
  });

  it("malformed payload (missing iv/ciphertext): dropped", async () => {
    const ROOM = "snap-malformed";
    const sender = await connectClient();
    await joinRoom(sender, ROOM);
    const target = await connectClient();
    await joinRoom(target, ROOM);

    let received = false;
    target.on("SCENE_SNAPSHOT", () => {
      received = true;
    });

    // Missing data.iv
    sender.emit("SCENE_SNAPSHOT", {
      roomId: ROOM,
      targetId: target.id,
      data: { ciphertext: "Zm9vYmFy" },
    });
    // Missing data entirely
    sender.emit("SCENE_SNAPSHOT", {
      roomId: ROOM,
      targetId: target.id,
    });
    // Missing targetId
    sender.emit("SCENE_SNAPSHOT", {
      roomId: ROOM,
      data: { iv: "aaaaaaaaaaaaaaaa", ciphertext: "Zm9vYmFy" },
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(received).toBe(false);

    sender.close();
    target.close();
  });

  it("oversized SCENE_SNAPSHOT (>256 KB): rate-limited via 4008 disconnect", async () => {
    const ROOM = "snap-oversized";
    const sender = await connectClient();
    await joinRoom(sender, ROOM);
    const target = await connectClient();
    await joinRoom(target, ROOM);

    let errorPayload: Record<string, unknown> | null = null;
    let disconnectReason: string | null = null;
    sender.on("ERROR", (err: Record<string, unknown>) => {
      errorPayload = err;
    });
    sender.on("disconnect", (reason: string) => {
      disconnectReason = reason;
    });

    sender.emit("SCENE_SNAPSHOT", {
      roomId: ROOM,
      targetId: target.id,
      data: { iv: "aaaaaaaaaaaaaaaa", ciphertext: "x".repeat(500_000) },
    });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (disconnectReason !== null) {
          clearInterval(check);
          resolve();
        }
      }, 5);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 3000);
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(disconnectReason).toBeTruthy();
    expect(errorPayload).not.toBeNull();
    expect(errorPayload!.code).toBe(4008);
    expect(errorPayload!.message).toBe("MESSAGE_TOO_LARGE");

    target.close();
  });
});
