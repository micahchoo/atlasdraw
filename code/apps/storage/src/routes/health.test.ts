// @atlasdraw/storage — Phase 4 T18: /health endpoint tests.

import Fastify from "fastify";
import { describe, it, expect } from "vitest";

import { registerHealthRoute } from "./health";

describe("registerHealthRoute", () => {
  it("returns 200 with status/uptime/storageMode", async () => {
    const app = Fastify();
    registerHealthRoute(app, "sqlite-fs");
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
    registerHealthRoute(app, "postgres-minio");
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json().storageMode).toBe("postgres-minio");
    await app.close();
  });
});
