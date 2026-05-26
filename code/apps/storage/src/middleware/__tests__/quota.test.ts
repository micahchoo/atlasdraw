// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — Phase 6 A13b quota middleware tests.

import Fastify, { type FastifyInstance } from "fastify";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSqliteFsAdapter } from "../../adapters/sqlite-fs";
import { registerMapRoutes } from "../../routes/maps";
import { registerQuotaMiddleware } from "../quota";
import { registerWorkspaceMiddleware } from "../workspace";

interface BuildOpts {
  managed: boolean;
  dataDir: string;
  free?: number;
  pro?: number;
}

function buildApp(opts: BuildOpts) {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  registerWorkspaceMiddleware(app, { managed: opts.managed });
  const client = createSqliteFsAdapter({ dataDir: opts.dataDir });
  registerQuotaMiddleware(app, {
    managed: opts.managed,
    client,
    limits: {
      free: opts.free ?? 3,
      pro: opts.pro ?? 100,
      pro_25: opts.pro ?? 100,
    },
  });
  registerMapRoutes(app, client);
  return { app, client };
}

describe("registerQuotaMiddleware", () => {
  let scratch: tmp.DirResult;
  let app: FastifyInstance;

  beforeEach(() => {
    scratch = tmp.dirSync({ unsafeCleanup: true });
  });
  afterEach(async () => {
    if (app) {
      await app.close();
    }
    scratch.removeCallback();
  });

  describe("self-host mode", () => {
    it("never enforces a quota — POST /maps stays open", async () => {
      const built = buildApp({
        managed: false,
        dataDir: scratch.name,
        free: 1,
      });
      app = built.app;
      await app.ready();
      // Even with free=1, self-host allows arbitrary creates.
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/maps",
          headers: { "content-type": "application/octet-stream" },
          payload: Buffer.from(`m${i}`),
        });
        expect(res.statusCode).toBe(201);
      }
    });
  });

  describe("managed mode", () => {
    it("free tier at limit returns 402 quota_exceeded", async () => {
      const built = buildApp({ managed: true, dataDir: scratch.name, free: 2 });
      app = built.app;
      await built.client.createWorkspace({
        id: "ws-free",
        name: "free workspace",
        plan: "free",
      });
      await app.ready();
      const make = (n: number) =>
        app.inject({
          method: "POST",
          url: "/maps",
          headers: {
            "content-type": "application/octet-stream",
            "x-workspace-id": "ws-free",
          },
          payload: Buffer.from(`m${n}`),
        });
      expect((await make(0)).statusCode).toBe(201);
      expect((await make(1)).statusCode).toBe(201);
      const blocked = await make(2);
      expect(blocked.statusCode).toBe(402);
      expect(blocked.json()).toEqual({
        error: "quota_exceeded",
        limit: "maps",
        current: 2,
        max: 2,
      });
    });

    it("pro tier passes where free fails (configurable per-plan)", async () => {
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        free: 1,
        pro: 10,
      });
      app = built.app;
      await built.client.createWorkspace({
        id: "ws-pro",
        name: "pro workspace",
        plan: "pro",
      });
      await app.ready();
      // 3 creates would exceed `free` (1) but is well under `pro` (10).
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/maps",
          headers: {
            "content-type": "application/octet-stream",
            "x-workspace-id": "ws-pro",
          },
          payload: Buffer.from(`p${i}`),
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it("managed mode + unknown workspace id returns 404", async () => {
      const built = buildApp({ managed: true, dataDir: scratch.name });
      app = built.app;
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/maps",
        headers: {
          "content-type": "application/octet-stream",
          "x-workspace-id": "ws-ghost",
        },
        payload: Buffer.from("x"),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "workspace_not_found" });
    });

    it("non-/maps POSTs are not gated", async () => {
      const built = buildApp({ managed: true, dataDir: scratch.name, free: 0 });
      app = built.app;
      await built.client.createWorkspace({
        id: "ws-x",
        name: "x",
        plan: "free",
      });
      await app.ready();
      // GET /maps/:id with a malformed id — quota middleware should
      // skip and we fall through to the route handler's 400.
      const res = await app.inject({
        method: "GET",
        url: "/maps/short",
        headers: { "x-workspace-id": "ws-x" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
