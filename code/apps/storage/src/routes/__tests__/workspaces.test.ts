// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — Phase 6 A13b /api/workspaces routes tests.

import Fastify, { type FastifyInstance } from "fastify";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSqliteFsAdapter } from "../../adapters/sqlite-fs";
import { registerWorkspaceRoutes } from "../workspaces";

function buildApp(managed: boolean, dataDir: string) {
  const app = Fastify({ logger: false });
  const client = createSqliteFsAdapter({ dataDir });
  registerWorkspaceRoutes(app, { managed, client });
  return { app, client };
}

describe("registerWorkspaceRoutes", () => {
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

  describe("self-host (managed=false)", () => {
    beforeEach(async () => {
      const built = buildApp(false, scratch.name);
      app = built.app;
      await app.ready();
    });
    it("GET /api/workspaces returns 404", async () => {
      const res = await app.inject({ method: "GET", url: "/api/workspaces" });
      expect(res.statusCode).toBe(404);
    });
    it("POST /api/workspaces returns 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        payload: { name: "x" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("managed mode", () => {
    let client: ReturnType<typeof createSqliteFsAdapter>;
    beforeEach(async () => {
      const built = buildApp(true, scratch.name);
      app = built.app;
      client = built.client;
      await app.ready();
    });
    it("GET /api/workspaces lists workspaces", async () => {
      await client.createWorkspace({ id: "a", name: "A", plan: "free" });
      await client.createWorkspace({ id: "b", name: "B", plan: "pro" });
      const res = await app.inject({ method: "GET", url: "/api/workspaces" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.workspaces).toHaveLength(2);
      expect(body.workspaces.map((w: { id: string }) => w.id).sort()).toEqual([
        "a",
        "b",
      ]);
    });
    it("POST /api/workspaces creates a free-tier workspace", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        payload: { name: "Acme Co" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe("Acme Co");
      expect(body.plan).toBe("free");
      expect(body.stripe_customer_id).toBeNull();
      expect(body.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    });
    it("POST /api/workspaces rejects missing name", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "name_required" });
    });
  });
});
