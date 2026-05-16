import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import * as path from "node:path";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteFsAdapter } from "../adapters/sqlite-fs";
import type { ShareToken, StorageClient } from "../types";
import { registerMapRoutes } from "./maps";
import { registerShareRoutes } from "./share";

// Spy-wrapping StorageClient — increments counters on the methods the
// share routes touch so we can assert that route-level validation rejects
// bad input BEFORE the adapter is called.
interface SpyClient extends StorageClient {
  calls: {
    createShareToken: number;
    resolveToken: number;
    getBlob: number;
  };
}

function wrapWithSpy(inner: StorageClient): SpyClient {
  const calls = { createShareToken: 0, resolveToken: 0, getBlob: 0 };
  return {
    calls,
    createMap: inner.createMap.bind(inner),
    getMap: inner.getMap.bind(inner),
    updateMap: inner.updateMap.bind(inner),
    createShareToken: async (mapId) => {
      calls.createShareToken += 1;
      return inner.createShareToken(mapId);
    },
    resolveToken: async (token) => {
      calls.resolveToken += 1;
      return inner.resolveToken(token);
    },
    getBlob: async (id) => {
      calls.getBlob += 1;
      return inner.getBlob(id);
    },
    // Phase 6 A13b/A13c: workspaces contract methods — share routes
    // don't touch these, but the StorageClient interface requires them.
    // Pass-through to the inner adapter so any incidental test that
    // exercises workspaces still works.
    createWorkspace: inner.createWorkspace.bind(inner),
    getWorkspace: inner.getWorkspace.bind(inner),
    listWorkspaces: inner.listWorkspaces.bind(inner),
    updateWorkspacePlan: inner.updateWorkspacePlan.bind(inner),
    countWorkspaceMaps: inner.countWorkspaceMaps.bind(inner),
    findWorkspaceByStripeCustomerId:
      inner.findWorkspaceByStripeCustomerId.bind(inner),
  };
}

function makeApp(
  scratchDir: string,
  publicUrl: string,
): { app: FastifyInstance; spy: SpyClient; dbPath: string } {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  const inner = createSqliteFsAdapter({ dataDir: scratchDir });
  const spy = wrapWithSpy(inner);
  registerMapRoutes(app, spy);
  registerShareRoutes(app, spy, publicUrl);
  return { app, spy, dbPath: path.join(scratchDir, "atlas.db") };
}

describe("/share routes", () => {
  let scratch: tmp.DirResult;
  let app: FastifyInstance;
  let spy: SpyClient;
  let dbPath: string;

  beforeEach(async () => {
    scratch = tmp.dirSync({ unsafeCleanup: true });
    ({ app, spy, dbPath } = makeApp(scratch.name, ""));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    scratch.removeCallback();
  });

  // ─── POST /maps/:id/share ───────────────────────────────────────────────

  describe("POST /maps/:id/share", () => {
    it("returns 201 with token/url/expires_at for an existing map (relative URL when PUBLIC_URL='')", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/maps",
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from("scene-bytes"),
      });
      const map = create.json();
      const res = await app.inject({
        method: "POST",
        url: `/maps/${map.id}/share`,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{21}$/);
      expect(body.url).toBe(`/m/${body.token}`);
      expect(typeof body.expires_at).toBe("string");
      // Sanity: TTL roughly 7 days out, not the epoch.
      const ms = new Date(body.expires_at).getTime();
      expect(ms).toBeGreaterThan(Date.now());
      expect(ms).toBeLessThan(Date.now() + 8 * 24 * 60 * 60 * 1000);
      expect(spy.calls.createShareToken).toBe(1);
    });

    it("returns an absolute URL when PUBLIC_URL is set", async () => {
      await app.close();
      ({ app, spy, dbPath } = makeApp(scratch.name, "https://x.example"));
      await app.ready();

      const create = await app.inject({
        method: "POST",
        url: "/maps",
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from("scene-bytes"),
      });
      const map = create.json();
      const res = await app.inject({
        method: "POST",
        url: `/maps/${map.id}/share`,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.url.startsWith("https://x.example/m/")).toBe(true);
      expect(body.url).toBe(`https://x.example/m/${body.token}`);
    });

    it("returns 404 for an unknown but well-formed map id", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/maps/${"a".repeat(21)}/share`,
      });
      expect(res.statusCode).toBe(404);
      // Pre-check rejects before any token mint.
      expect(spy.calls.createShareToken).toBe(0);
    });

    it.each([
      ["aaa", "short"],
      ["../etc", "traversal"],
      ["a".repeat(22), "too-long"],
      ["!".repeat(21), "illegal-chars"],
      [" ".repeat(21), "whitespace"],
    ])(
      "returns 400 for invalid id (%s — %s) without invoking adapter",
      async (badId) => {
        const res = await app.inject({
          method: "POST",
          url: `/maps/${encodeURIComponent(badId)}/share`,
        });
        expect(res.statusCode).toBe(400);
        expect(spy.calls.createShareToken).toBe(0);
      },
    );
  });

  // ─── GET /share/:token ──────────────────────────────────────────────────

  describe("GET /share/:token", () => {
    async function mintTokenForFreshMap(): Promise<{
      mapId: string;
      token: string;
    }> {
      const create = await app.inject({
        method: "POST",
        url: "/maps",
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from("scene-bytes"),
      });
      const map = create.json();
      const share = await app.inject({
        method: "POST",
        url: `/maps/${map.id}/share`,
      });
      const body = share.json();
      return { mapId: map.id, token: body.token };
    }

    it("returns 200 with {map, mode:'read'} for a valid token (roundtrip)", async () => {
      const { mapId, token } = await mintTokenForFreshMap();
      const callsBefore = spy.calls.resolveToken;
      const res = await app.inject({
        method: "GET",
        url: `/share/${token}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mode).toBe("read");
      expect(body.map.id).toBe(mapId);
      expect(body.map.byte_size).toBe(11);
      expect(spy.calls.resolveToken).toBe(callsBefore + 1);
    });

    it("mode is always 'read' even when caller passes ?mode=write", async () => {
      const { token } = await mintTokenForFreshMap();
      const res = await app.inject({
        method: "GET",
        url: `/share/${token}?mode=write`,
        // Fastify GET ignores body but we exercise the assertion anyway.
        payload: { mode: "write" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().mode).toBe("read");
    });

    it("returns 404 for an unknown but well-formed token", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/share/${"z".repeat(21)}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 410 when token is expired", async () => {
      const { token } = await mintTokenForFreshMap();
      // Backdate the row directly — the adapter contract doesn't expose
      // a TTL knob, so we drop to SQL. Same db path the adapter opened.
      const db = new Database(dbPath);
      const pastIso = new Date(Date.now() - 60_000).toISOString();
      const updated = db
        .prepare("UPDATE share_tokens SET expires_at = ? WHERE token = ?")
        .run(pastIso, token);
      expect(updated.changes).toBe(1);
      db.close();

      const res = await app.inject({
        method: "GET",
        url: `/share/${token}`,
      });
      expect(res.statusCode).toBe(410);
    });

    it("returns 410 for an orphaned token (map deleted under it)", async () => {
      const { mapId, token } = await mintTokenForFreshMap();
      // Phase 4 has no DELETE /maps route — drop the row directly. The
      // schema declares a FOREIGN KEY share_tokens.map_id → maps.id, so
      // we disable FK enforcement on this connection to simulate the
      // orphaned state (e.g. operator-level delete, future Phase work).
      const db = new Database(dbPath);
      db.pragma("foreign_keys = OFF");
      const result = db
        .prepare("DELETE FROM maps WHERE id = ?")
        .run(mapId);
      expect(result.changes).toBe(1);
      db.close();

      const res = await app.inject({
        method: "GET",
        url: `/share/${token}`,
      });
      expect(res.statusCode).toBe(410);
    });

    it.each([
      ["..etcpasswd", "traversal-flat"],
      ["short", "too-short"],
      ["!".repeat(21), "illegal-chars"],
      ["a".repeat(22), "too-long"],
    ])(
      "returns 400 for invalid token format (%s — %s) without invoking adapter",
      async (badToken) => {
        const before = spy.calls.resolveToken;
        const res = await app.inject({
          method: "GET",
          url: `/share/${encodeURIComponent(badToken)}`,
        });
        expect(res.statusCode).toBe(400);
        expect(spy.calls.resolveToken).toBe(before);
      },
    );
  });

  // ─── GET /share/:token/blob ─────────────────────────────────────────────

  describe("GET /share/:token/blob", () => {
    async function mintTokenForFreshMap(payload: Buffer): Promise<{
      mapId: string;
      token: string;
    }> {
      const create = await app.inject({
        method: "POST",
        url: "/maps",
        headers: { "content-type": "application/octet-stream" },
        payload,
      });
      const map = create.json();
      const share = await app.inject({
        method: "POST",
        url: `/maps/${map.id}/share`,
      });
      const body = share.json();
      return { mapId: map.id, token: body.token };
    }

    it("returns 200 with the raw blob bytes for a valid token", async () => {
      const payload = Buffer.from("hello, atlas world");
      const { token } = await mintTokenForFreshMap(payload);
      const callsBefore = spy.calls.getBlob;
      const res = await app.inject({
        method: "GET",
        url: `/share/${token}/blob`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(res.headers["cache-control"]).toBe("private, max-age=60");
      // res.rawPayload is a Buffer in fastify inject's response.
      expect(Buffer.from(res.rawPayload).equals(payload)).toBe(true);
      expect(spy.calls.getBlob).toBe(callsBefore + 1);
    });

    it("returns 404 for an unknown but well-formed token", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/share/${"z".repeat(21)}/blob`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 410 when the token is expired", async () => {
      const { token } = await mintTokenForFreshMap(Buffer.from("x"));
      const db = new Database(dbPath);
      const pastIso = new Date(Date.now() - 60_000).toISOString();
      const updated = db
        .prepare("UPDATE share_tokens SET expires_at = ? WHERE token = ?")
        .run(pastIso, token);
      expect(updated.changes).toBe(1);
      db.close();

      const res = await app.inject({
        method: "GET",
        url: `/share/${token}/blob`,
      });
      expect(res.statusCode).toBe(410);
    });

    it("returns 410 for an orphaned token (map row deleted under it)", async () => {
      const { mapId, token } = await mintTokenForFreshMap(Buffer.from("x"));
      const db = new Database(dbPath);
      db.pragma("foreign_keys = OFF");
      const result = db
        .prepare("DELETE FROM maps WHERE id = ?")
        .run(mapId);
      expect(result.changes).toBe(1);
      db.close();

      const res = await app.inject({
        method: "GET",
        url: `/share/${token}/blob`,
      });
      expect(res.statusCode).toBe(410);
    });

    it.each([
      ["short", "too-short"],
      ["!".repeat(21), "illegal-chars"],
      ["a".repeat(22), "too-long"],
    ])(
      "returns 400 for invalid token format (%s — %s) without invoking adapter",
      async (badToken) => {
        const before = spy.calls.resolveToken;
        const res = await app.inject({
          method: "GET",
          url: `/share/${encodeURIComponent(badToken)}/blob`,
        });
        expect(res.statusCode).toBe(400);
        expect(spy.calls.resolveToken).toBe(before);
      },
    );
  });

  // Belt-and-suspenders: the share-record itself never leaks `mode` from
  // a tampered DB row (T3 already hard-codes "read" in rowToShare, but
  // since T4 also literal-pins "read" in the response, double-confirm).
  it("response mode stays 'read' even if the DB row has been tampered to 'write'", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/maps",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("xx"),
    });
    const map = create.json();
    const share = await app.inject({
      method: "POST",
      url: `/maps/${map.id}/share`,
    });
    const { token } = share.json() as ShareToken & { url: string };

    const db = new Database(dbPath);
    db.prepare("UPDATE share_tokens SET mode = 'write' WHERE token = ?").run(
      token,
    );
    db.close();

    const res = await app.inject({ method: "GET", url: `/share/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe("read");
  });
});
