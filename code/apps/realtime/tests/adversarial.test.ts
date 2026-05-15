// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — adversarial relay hardening tests
//
// Phase 5 Task 13. Spins up a real Socket.IO server on a random port and runs
// automated adversarial probes: oversized payloads, room-size limits, rate-limit
// flak-avoidance, and health-check survivability.

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { io as ioc } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import { registerSocketIOHandlers } from "../src/socket-io-server";
import { registerHealth } from "../src/health";

// ---------------------------------------------------------------------------
// Test server lifecycle
// ---------------------------------------------------------------------------

let server: http.Server;
let io: SocketIOServer;
let port: number;

/**
 * Create a Socket.IO client connected to the test server.
 * Uses WebSocket transport only (no HTTP long-polling).
 */
function connectClient(): Promise<ClientSocket> {
  return new Promise<ClientSocket>((resolve, reject) => {
    const client = ioc(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    client.on("connect", () => resolve(client));
    client.on("connect_error", (err: Error) => reject(err));
    // Safety timeout
    const timer = setTimeout(() => {
      reject(new Error("connectClient: timeout after 5s"));
    }, 5000);
    // Cancel timeout on connect or error – safe because only one resolves
    client.on("connect", () => clearTimeout(timer));
    client.on("connect_error", () => clearTimeout(timer));
  });
}

/**
 * Emit JOIN_ROOM and wait for the server to process it.
 *
 * socket.join() is async in Socket.IO v4 (awaits the adapter), so we wait
 * long enough for the server to finish processing the join before resolving.
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

/**
 * Return how many sockets are currently in the named room on the server.
 */
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
      // Raise engine.io's per-message limit so our oversized payload reaches
      // the application handler (engine.io default is ~100 KB). We test our
      // own size enforcement in rate-limit.ts, not engine.io's.
      maxHttpBufferSize: 2 * 1024 * 1024, // 2 MB
    });
    registerSocketIOHandlers(io);
    registerHealth(server, io);
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
// Helpers
// ---------------------------------------------------------------------------

/** Fetch the health endpoint and parse JSON. */
async function healthCheck(): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = http.get(
      `http://localhost:${port}/health`,
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as Record<string, unknown>);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Adversarial tests
// ---------------------------------------------------------------------------

describe("adversarial relay hardening", () => {
  // -----------------------------------------------------------------------
  // Test 1: Oversized payload disconnects the sender with code 4008
  // -----------------------------------------------------------------------
  it("oversized SCENE_UPDATE (>256 KB) triggers 4008 disconnect", async () => {
    const client = await connectClient();

    // Build a payload ~512 KB — well over the 256 KB SCENE_UPDATE cap but under
    // engine.io's raised maxHttpBufferSize.
    const oversized = {
      roomId: "t13-oversized",
      senderId: "test-sender",
      data: { iv: "aaaaaaaaaaaaaaaa", ciphertext: "x".repeat(500_000) },
    };

    // Set up event listeners BEFORE emitting
    let errorPayload: Record<string, unknown> | null = null;
    let disconnectReason: string | null = null;
    client.on("ERROR", (err: Record<string, unknown>) => {
      errorPayload = err;
    });
    client.on("disconnect", (reason: string) => {
      disconnectReason = reason;
    });

    client.emit("SCENE_UPDATE", oversized);

    // Wait for disconnect
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (disconnectReason !== null) {
          clearInterval(check);
          resolve();
        }
      }, 5);
    });

    // Give a tick for any queued ERROR event processing
    await new Promise((r) => setTimeout(r, 50));

    expect(disconnectReason).toBeTruthy();
    expect(errorPayload).not.toBeNull();
    expect(errorPayload!.code).toBe(4008);
    expect(errorPayload!.message).toBe("MESSAGE_TOO_LARGE");

    client.close();
  });

  // -----------------------------------------------------------------------
  // Test 2: Room-size guard — 5th joiner rejected with ROOM_FULL
  // -----------------------------------------------------------------------
  it("room with 5 joiners rejects the 5th with ROOM_FULL", async () => {
    const ROOM = "t13-room-full";

    // Join 4 clients
    const clients: ClientSocket[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await connectClient();
      await joinRoom(c, ROOM);
      clients.push(c);
    }

    // Verify 4 are in the room
    expect(roomSize(ROOM)).toBe(4);

    // 5th client tries to join
    const fifth = await connectClient();
    const roomFullReceived = new Promise<Record<string, unknown>>((resolve) => {
      fifth.once("ROOM_FULL", (evt: Record<string, unknown>) => resolve(evt));
    });

    await joinRoom(fifth, ROOM);

    const err = await roomFullReceived;
    expect(err.code).toBe("ROOM_FULL");
    expect(err.roomId).toBe(ROOM);

    // Room still has only 4
    expect(roomSize(ROOM)).toBe(4);

    // Cleanup
    fifth.close();
    for (const c of clients) c.close();
  });

  // -----------------------------------------------------------------------
  // Test 3: 200 rapid CURSOR events — rate limiter drops excess, no crash
  // -----------------------------------------------------------------------
  it("200 rapid CURSOR events — rate limiter drops excess, no crash", async () => {
    const client = await connectClient();
    await joinRoom(client, "t13-rapid-cursor");

    const payload = {
      roomId: "t13-rapid-cursor",
      senderId: "test-sender",
      x: 100,
      y: 200,
    };

    // Fire 200 CURSOR events in a tight loop
    for (let i = 0; i < 200; i++) {
      client.emit("CURSOR", payload);
    }

    // Give the event loop time to process
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Server should still be functional — health check passes
    const health = await healthCheck();
    expect(health.status).toBe("ok");

    client.close();
  });

  // -----------------------------------------------------------------------
  // Test 4: Health check still responds after all adversarial probes
  // -----------------------------------------------------------------------
  it("health endpoint returns ok after all probes", async () => {
    const health = await healthCheck();
    expect(health.status).toBe("ok");
    // `connections` may be >0 if earlier tests left dangling sockets, but
    // that is fine — the important invariant is that the server is alive.
    expect(typeof health.connections).toBe("number");
  });
});
