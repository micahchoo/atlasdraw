// Share routes against a real SQLite store in a temp dir.
//
// A share token is a read capability for one map's LATEST bytes. Only the
// map's write key mints or revokes one. Nothing a token holder can fetch
// carries the map id or the write key, and a token never works as a key.

import * as path from "node:path";

import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSqliteFsAdapter } from "../adapters/sqlite-fs";
import { createMapService } from "../service/maps";

import { registerMapRoutes } from "./maps";
import { registerShareRoutes } from "./share";

const OCTETS = { "content-type": "application/octet-stream" };
const DAY_MS = 24 * 60 * 60 * 1000;

function bearer(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

function makeApp(scratchDir: string, publicUrl: string): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  const service = createMapService(
    createSqliteFsAdapter({ dataDir: scratchDir }),
    { maxTotalBytes: 0 },
  );
  registerMapRoutes(app, service);
  registerShareRoutes(app, service, publicUrl);
  return app;
}

describe("share routes", () => {
  let scratch: tmp.DirResult;
  let app: FastifyInstance;
  let dbPath: string;

  beforeEach(async () => {
    scratch = tmp.dirSync({ unsafeCleanup: true });
    dbPath = path.join(scratch.name, "atlas.db");
    app = makeApp(scratch.name, "");
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    scratch.removeCallback();
  });

  async function createMap(
    bytes = "scene-bytes",
  ): Promise<{ id: string; writeKey: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/maps",
      headers: OCTETS,
      payload: Buffer.from(bytes),
    });
    return { id: res.json().id, writeKey: res.json().write_key };
  }

  async function share(
    id: string,
    writeKey: string,
    body?: unknown,
  ): Promise<{ token: string; url: string; expires_at: string | null }> {
    const res = await app.inject({
      method: "POST",
      url: `/maps/${id}/share`,
      headers: bearer(writeKey),
      ...(body === undefined ? {} : { payload: body as object }),
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  function readShared(token: string) {
    return app.inject({ method: "GET", url: `/share/${token}/blob` });
  }

  describe("POST /maps/:id/share", () => {
    it("mints a token that does not expire, with a relative URL", async () => {
      const { id, writeKey } = await createMap();

      const body = await share(id, writeKey);

      expect(body.token).toMatch(/^[A-Za-z0-9_-]{21}$/);
      expect(body.url).toBe(`/m/${body.token}`);
      expect(body.expires_at).toBeNull();
    });

    it("returns an absolute URL when PUBLIC_URL is set", async () => {
      await app.close();
      app = makeApp(scratch.name, "https://x.example");
      await app.ready();
      const { id, writeKey } = await createMap();

      const body = await share(id, writeKey);

      expect(body.url).toBe(`https://x.example/m/${body.token}`);
    });

    it("sets an expiry when the owner asks for one", async () => {
      const { id, writeKey } = await createMap();

      const body = await share(id, writeKey, { expires_in_days: 7 });

      const ms = new Date(body.expires_at!).getTime() - Date.now();
      expect(ms).toBeGreaterThan(7 * DAY_MS - 60_000);
      expect(ms).toBeLessThanOrEqual(7 * DAY_MS);
    });

    it.each([[0], [-1], [1.5], ["7"], [3651]])(
      "returns 400 for expires_in_days %j",
      async (days) => {
        const { id, writeKey } = await createMap();
        const res = await app.inject({
          method: "POST",
          url: `/maps/${id}/share`,
          headers: bearer(writeKey),
          payload: { expires_in_days: days },
        });
        expect(res.statusCode).toBe(400);
      },
    );

    it("refuses no key with 401 and a wrong key with 403", async () => {
      const { id } = await createMap();
      const other = await createMap();

      const none = await app.inject({
        method: "POST",
        url: `/maps/${id}/share`,
      });
      const wrong = await app.inject({
        method: "POST",
        url: `/maps/${id}/share`,
        headers: bearer(other.writeKey),
      });

      expect(none.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(403);
    });

    it("returns 404 for an unknown but well-formed map id", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/maps/${"a".repeat(21)}/share`,
        headers: bearer("k".repeat(43)),
      });
      expect(res.statusCode).toBe(404);
    });

    it.each([
      ["aaa", "short"],
      ["../etc", "traversal"],
      ["a".repeat(22), "too-long"],
      ["!".repeat(21), "illegal-chars"],
    ])("returns 400 for invalid id (%s — %s)", async (badId) => {
      const res = await app.inject({
        method: "POST",
        url: `/maps/${encodeURIComponent(badId)}/share`,
        headers: bearer("k".repeat(43)),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /share/:token/blob", () => {
    it("returns the map's raw bytes", async () => {
      const { id, writeKey } = await createMap("hello, atlas world");
      const { token } = await share(id, writeKey);

      const res = await readShared(token);

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.body).toBe("hello, atlas world");
    });

    it("serves the latest bytes: a write updates every link", async () => {
      const { id, writeKey } = await createMap("v1");
      const first = await share(id, writeKey);
      const second = await share(id, writeKey);

      await app.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: { ...OCTETS, ...bearer(writeKey) },
        payload: Buffer.from("v2"),
      });

      expect((await readShared(first.token)).body).toBe("v2");
      expect((await readShared(second.token)).body).toBe("v2");
    });

    it("returns 404 for an unknown but well-formed token", async () => {
      const res = await readShared("z".repeat(21));
      expect(res.statusCode).toBe(404);
    });

    it("returns 410 when the token has expired", async () => {
      const { id, writeKey } = await createMap();
      const { token } = await share(id, writeKey, { expires_in_days: 1 });
      const db = new Database(dbPath);
      db.prepare("UPDATE share_tokens SET expires_at = ? WHERE token = ?").run(
        new Date(Date.now() - 60_000).toISOString(),
        token,
      );
      db.close();

      expect((await readShared(token)).statusCode).toBe(410);
    });

    it("returns 410 for an orphaned token (map row deleted under it)", async () => {
      const { id, writeKey } = await createMap();
      const { token } = await share(id, writeKey);
      const db = new Database(dbPath);
      db.pragma("foreign_keys = OFF");
      db.prepare("DELETE FROM maps WHERE id = ?").run(id);
      db.close();

      expect((await readShared(token)).statusCode).toBe(410);
    });

    it.each([["short"], ["!".repeat(21)], ["a".repeat(22)]])(
      "returns 400 for invalid token format %s",
      async (bad) => {
        const res = await app.inject({
          method: "GET",
          url: `/share/${encodeURIComponent(bad)}/blob`,
        });
        expect(res.statusCode).toBe(400);
      },
    );
  });

  describe("DELETE /maps/:id/share/:token", () => {
    it("revokes the token: 204, then the link is gone", async () => {
      const { id, writeKey } = await createMap();
      const { token } = await share(id, writeKey);

      const res = await app.inject({
        method: "DELETE",
        url: `/maps/${id}/share/${token}`,
        headers: bearer(writeKey),
      });

      expect(res.statusCode).toBe(204);
      expect((await readShared(token)).statusCode).toBe(404);
    });

    it("leaves the map's other tokens working", async () => {
      const { id, writeKey } = await createMap("kept");
      const revoked = await share(id, writeKey);
      const kept = await share(id, writeKey);

      await app.inject({
        method: "DELETE",
        url: `/maps/${id}/share/${revoked.token}`,
        headers: bearer(writeKey),
      });

      expect((await readShared(kept.token)).body).toBe("kept");
    });

    it("refuses no key with 401 and a wrong key with 403", async () => {
      const { id, writeKey } = await createMap();
      const other = await createMap();
      const { token } = await share(id, writeKey);

      const none = await app.inject({
        method: "DELETE",
        url: `/maps/${id}/share/${token}`,
      });
      const wrong = await app.inject({
        method: "DELETE",
        url: `/maps/${id}/share/${token}`,
        headers: bearer(other.writeKey),
      });

      expect(none.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(403);
      expect((await readShared(token)).statusCode).toBe(200);
    });

    it("returns 404 for a token of another map, and that token stays", async () => {
      const mine = await createMap();
      const theirs = await createMap();
      const { token } = await share(theirs.id, theirs.writeKey);

      const res = await app.inject({
        method: "DELETE",
        url: `/maps/${mine.id}/share/${token}`,
        headers: bearer(mine.writeKey),
      });

      expect(res.statusCode).toBe(404);
      expect((await readShared(token)).statusCode).toBe(200);
    });

    it("returns 404 the second time", async () => {
      const { id, writeKey } = await createMap();
      const { token } = await share(id, writeKey);
      const revoke = () =>
        app.inject({
          method: "DELETE",
          url: `/maps/${id}/share/${token}`,
          headers: bearer(writeKey),
        });

      expect((await revoke()).statusCode).toBe(204);
      expect((await revoke()).statusCode).toBe(404);
    });
  });

  describe("a share token holder", () => {
    it("can fetch the bytes but never learns the map id or the key", async () => {
      const { id, writeKey } = await createMap();
      const { token } = await share(id, writeKey);

      const res = await readShared(token);

      expect(res.statusCode).toBe(200);
      for (const secret of [id, writeKey]) {
        expect(res.body).not.toContain(secret);
        expect(JSON.stringify(res.headers)).not.toContain(secret);
      }
    });

    it("can never write, share or revoke with the token", async () => {
      const { id, writeKey } = await createMap("original");
      const { token } = await share(id, writeKey);

      const put = await app.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: { ...OCTETS, ...bearer(token) },
        payload: Buffer.from("defaced"),
      });
      const putAtToken = await app.inject({
        method: "PUT",
        url: `/maps/${token}`,
        headers: { ...OCTETS, ...bearer(token) },
        payload: Buffer.from("defaced"),
      });
      const mint = await app.inject({
        method: "POST",
        url: `/maps/${id}/share`,
        headers: bearer(token),
      });
      const revoke = await app.inject({
        method: "DELETE",
        url: `/maps/${id}/share/${token}`,
        headers: bearer(token),
      });
      const backup = await app.inject({
        method: "GET",
        url: `/maps/${id}/blob`,
        headers: bearer(token),
      });

      expect(put.statusCode).toBe(403);
      expect(putAtToken.statusCode).toBe(404);
      expect(mint.statusCode).toBe(403);
      expect(revoke.statusCode).toBe(403);
      expect(backup.statusCode).toBe(403);
      expect((await readShared(token)).body).toBe("original");
    });
  });
});
