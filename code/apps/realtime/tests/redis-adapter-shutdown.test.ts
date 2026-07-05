// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — attachRedisAdapterIfConfigured return-value test
// (ISSUES.md Issue 8). Before this fix, the function returned void, so
// index.ts had no handle to `.quit()` the two ioredis clients on shutdown —
// `docker compose stop` left them open until the OS reaped the process.

import http from "http";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Server as SocketIOServer } from "socket.io";

import { attachRedisAdapterIfConfigured } from "../src/redis-adapter";

vi.mock("ioredis", () => {
  class Redis {
    quit = vi.fn().mockResolvedValue("OK");
    on = vi.fn();
    constructor(public url: string) {}
  }
  return { Redis };
});

vi.mock("@socket.io/redis-adapter", () => ({
  createAdapter: vi.fn(
    () =>
      class FakeAdapter {
        init() {}
        close() {}
      },
  ),
}));

describe("attachRedisAdapterIfConfigured", () => {
  const server = http.createServer();
  const io = new SocketIOServer(server);

  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("returns null (nothing to quit on shutdown) when REDIS_URL is unset", () => {
    expect(attachRedisAdapterIfConfigured(io)).toBeNull();
  });

  it("returns the pub/sub clients so shutdown can quit them when REDIS_URL is set", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const result = attachRedisAdapterIfConfigured(io);
    expect(result).not.toBeNull();
    await expect(result!.pubClient.quit()).resolves.toBe("OK");
    await expect(result!.subClient.quit()).resolves.toBe("OK");
  });
});
