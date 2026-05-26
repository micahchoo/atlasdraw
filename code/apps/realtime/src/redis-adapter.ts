/* eslint-disable no-console */
// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — optional Redis adapter for multi-instance scaling.
//
// Phase 5 Task 15 (atlasdraw plan 2026-05-03 § Task 15). When REDIS_URL is set,
// wires @socket.io/redis-adapter so that Socket.IO rooms fan out across multiple
// relay instances via Redis pub/sub. Without REDIS_URL the relay runs stand-alone.
//
// Channel prefix: atlasdraw:sio (set via key option on createAdapter).
// Reserved naming: atlasdraw:yjs:* for Phase 6 Yjs persistence.

import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";

import type { Server as SocketIOServer } from "socket.io";

/**
 * Optionally attach the Redis pub/sub adapter to the Socket.IO server.
 *
 * - If `REDIS_URL` env var is unset/falsy: log "[realtime] Redis adapter disabled"
 *   and return immediately.
 * - If `REDIS_URL` is set: create two ioredis clients (pub + sub), call
 *   `io.adapter(createAdapter(...))` with channel key `atlasdraw:sio`, and log
 *   success. Redis connection errors are logged as WARN — they do not crash the
 *   process.
 */
export function attachRedisAdapterIfConfigured(io: SocketIOServer): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log("[realtime] Redis adapter disabled");
    return;
  }

  const pubClient = new Redis(redisUrl);
  const subClient = new Redis(redisUrl);

  // Log Redis connection errors without crashing.
  pubClient.on("error", (err: Error) => {
    console.warn("[realtime] Redis pub client error:", err.message);
  });
  subClient.on("error", (err: Error) => {
    console.warn("[realtime] Redis sub client error:", err.message);
  });

  io.adapter(createAdapter(pubClient, subClient, { key: "atlasdraw:sio" }));

  console.log(
    "[realtime] Redis adapter attached — channel prefix atlasdraw:sio",
  );
}
