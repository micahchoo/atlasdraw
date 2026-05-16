// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — Phase 6 A9 workspace middleware tests.
//
// Three modes:
//   - managed mode + missing header → 401 WORKSPACE_REQUIRED
//   - managed mode + header present → passthrough, workspace attached
//   - self-host mode → always passthrough, no header required

import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { registerWorkspaceMiddleware } from "../workspace";

function makeApp(managed: boolean): FastifyInstance {
  const app = Fastify({ logger: false });
  registerWorkspaceMiddleware(app, { managed });
  app.get("/probe", async (request) => ({
    workspace: request.workspace ?? null,
  }));
  app.get("/health", async () => ({ ok: true }));
  return app;
}

describe("registerWorkspaceMiddleware", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  describe("managed mode", () => {
    beforeEach(async () => {
      app = makeApp(true);
      await app.ready();
    });

    it("returns 401 WORKSPACE_REQUIRED when header is absent", async () => {
      const res = await app.inject({ method: "GET", url: "/probe" });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "WORKSPACE_REQUIRED" });
    });

    it("returns 401 when header is empty string", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-workspace-id": "" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("attaches request.workspace when header is present", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-workspace-id": "ws-abc" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ workspace: "ws-abc" });
    });

    it("bypasses gating on /health (probes must work without a workspace)", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("self-host mode (managed=false)", () => {
    beforeEach(async () => {
      app = makeApp(false);
      await app.ready();
    });

    it("passes through with no header, request.workspace undefined", async () => {
      const res = await app.inject({ method: "GET", url: "/probe" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ workspace: null });
    });

    it("attaches request.workspace when an operator-provided header is present", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-workspace-id": "ws-self" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ workspace: "ws-self" });
    });
  });
});
