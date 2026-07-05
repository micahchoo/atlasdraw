// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — per-IP rate limiter tests (SECURITY.md row 7).

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerRateLimitMiddleware } from "../rate-limit";

function buildApp(opts: { max: number; windowMs: number }): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true });
  registerRateLimitMiddleware(app, opts);
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/maps/:id", async () => ({ ok: true }));
  return app;
}

describe("registerRateLimitMiddleware", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("allows requests up to the cap, then 429s within the window", async () => {
    app = buildApp({ max: 2, windowMs: 60000 });

    const r1 = await app.inject({ method: "GET", url: "/maps/a" });
    const r2 = await app.inject({ method: "GET", url: "/maps/a" });
    const r3 = await app.inject({ method: "GET", url: "/maps/a" });

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r3.statusCode).toBe(429);
    expect(r3.json()).toEqual({ error: "rate_limited" });
    // Retry-After is present and a positive integer number of seconds.
    expect(Number(r3.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("never throttles /health", async () => {
    app = buildApp({ max: 1, windowMs: 60000 });

    // Burn the cap on a normal route first.
    await app.inject({ method: "GET", url: "/maps/a" });
    await app.inject({ method: "GET", url: "/maps/a" }); // 429

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    }
  });

  it("scopes the window per client IP", async () => {
    app = buildApp({ max: 1, windowMs: 60000 });

    // Two distinct forwarded IPs (trustProxy reads X-Forwarded-For). Each gets
    // its own window, so neither trips the other's cap on its first request.
    const a = await app.inject({
      method: "GET",
      url: "/maps/a",
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    const b = await app.inject({
      method: "GET",
      url: "/maps/a",
      headers: { "x-forwarded-for": "203.0.113.2" },
    });

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
  });

  it("is a no-op when max is 0 (disabled)", async () => {
    app = buildApp({ max: 0, windowMs: 60000 });

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: "GET", url: "/maps/a" });
      expect(res.statusCode).toBe(200);
    }
  });
});
