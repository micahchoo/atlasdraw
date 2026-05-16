// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — Phase 6 A9 workspace-scoped routes integration.
//
// Wires the workspace middleware + maps + share routes together and asserts:
//   - self-host (no middleware applied / no header): workspace_id is null on
//     persisted records — backward compat with Phase 4 self-host operators.
//   - managed mode + header: persistence carries the workspace_id forward.

import Fastify, { type FastifyInstance } from "fastify";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteFsAdapter } from "../../adapters/sqlite-fs";
import { registerWorkspaceMiddleware } from "../../middleware/workspace";
import { registerMapRoutes } from "../maps";
import { registerShareRoutes } from "../share";

function makeApp(managed: boolean, dataDir: string): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  registerWorkspaceMiddleware(app, { managed });
  const client = createSqliteFsAdapter({ dataDir });
  registerMapRoutes(app, client);
  registerShareRoutes(app, client, "");
  return app;
}

describe("workspace-scoped persistence", () => {
  let scratch: tmp.DirResult;
  let app: FastifyInstance;

  beforeEach(() => {
    scratch = tmp.dirSync({ unsafeCleanup: true });
  });

  afterEach(async () => {
    if (app) await app.close();
    scratch.removeCallback();
  });

  describe("self-host (managed=false)", () => {
    beforeEach(async () => {
      app = makeApp(false, scratch.name);
      await app.ready();
    });

    it("createMap without header persists workspace_id=null (Phase 4 compat)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/maps",
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from("self-host map"),
      });
      expect(create.statusCode).toBe(201);
      expect(create.json().workspace_id).toBeNull();

      const fetched = await app.inject({
        method: "GET",
        url: `/maps/${create.json().id}`,
      });
      expect(fetched.json().workspace_id).toBeNull();
    });

    it("createShareToken without header persists workspace_id=null", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/maps",
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from("for-share"),
      });
      const id = create.json().id;
      const share = await app.inject({
        method: "POST",
        url: `/maps/${id}/share`,
      });
      expect(share.statusCode).toBe(201);
      // The share response only echoes token/url/expires_at — workspace_id
      // is internal-only. Resolve via /share/:token to surface the map row
      // and confirm both records still null-workspace.
      const resolved = await app.inject({
        method: "GET",
        url: `/share/${share.json().token}`,
      });
      expect(resolved.statusCode).toBe(200);
      expect(resolved.json().map.workspace_id).toBeNull();
    });
  });

  describe("managed mode (managed=true)", () => {
    beforeEach(async () => {
      app = makeApp(true, scratch.name);
      await app.ready();
    });

    it("createMap with workspace header persists workspace_id=<ws>", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/maps",
        headers: {
          "content-type": "application/octet-stream",
          "x-workspace-id": "ws-alpha",
        },
        payload: Buffer.from("alpha map"),
      });
      expect(create.statusCode).toBe(201);
      expect(create.json().workspace_id).toBe("ws-alpha");
    });

    it("createMap without header returns 401 WORKSPACE_REQUIRED", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/maps",
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from("nope"),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "WORKSPACE_REQUIRED" });
    });

    it("createShareToken with workspace header scopes the token", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/maps",
        headers: {
          "content-type": "application/octet-stream",
          "x-workspace-id": "ws-beta",
        },
        payload: Buffer.from("beta"),
      });
      const id = create.json().id;
      const share = await app.inject({
        method: "POST",
        url: `/maps/${id}/share`,
        headers: { "x-workspace-id": "ws-beta" },
      });
      expect(share.statusCode).toBe(201);
      const resolved = await app.inject({
        method: "GET",
        url: `/share/${share.json().token}`,
        headers: { "x-workspace-id": "ws-beta" },
      });
      expect(resolved.statusCode).toBe(200);
      expect(resolved.json().map.workspace_id).toBe("ws-beta");
    });
  });
});
