// @atlasdraw/storage — Phase 4 T18: /health endpoint tests.
// ISSUES.md Issue 8: /health now pings the adapter's real dependencies
// instead of returning an unconditional 200.

import Fastify from "fastify";
import { describe, it, expect, vi } from "vitest";

import { registerHealthRoute } from "./health";

import type { StorageClient } from "../types";

function fakeClient(ping: () => Promise<void>): StorageClient {
  return { ping } as unknown as StorageClient;
}

describe("registerHealthRoute", () => {
  it("returns 200 with status/uptime/storageMode when the dependency ping succeeds", async () => {
    const app = Fastify();
    registerHealthRoute(
      app,
      "sqlite-fs",
      fakeClient(vi.fn().mockResolvedValue(undefined)),
    );
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.storageMode).toBe("sqlite-fs");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    await app.close();
  });

  it("reflects the storage mode it was registered with", async () => {
    const app = Fastify();
    registerHealthRoute(
      app,
      "postgres-minio",
      fakeClient(vi.fn().mockResolvedValue(undefined)),
    );
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json().storageMode).toBe("postgres-minio");
    await app.close();
  });

  it("returns 503 (not a fake 200) when the dependency ping rejects — ISSUES.md Issue 8", async () => {
    const app = Fastify();
    registerHealthRoute(
      app,
      "postgres-minio",
      fakeClient(vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))),
    );
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("error");
    expect(body.error).toContain("ECONNREFUSED");
    await app.close();
  });
});
