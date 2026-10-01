// /maps routes against a real SQLite store in a temp dir. A map carries a
// write key: create returns it once, and every write or owner read must show
// it in `Authorization: Bearer <key>`.

import * as fs from "node:fs";
import * as path from "node:path";

import Database from "better-sqlite3";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OCTETS, bearer, makeTestApp } from "../test-support";

import type { FastifyInstance } from "fastify";

const UNKNOWN_ID = "a".repeat(21);

function makeApp(
  dataDir: string,
  opts: { bodyLimit?: number; maxTotalBytes?: number } = {},
): FastifyInstance {
  const env: Record<string, string> = {};
  if (opts.bodyLimit !== undefined) {
    env.MAX_MAP_BYTES = String(opts.bodyLimit);
  }
  if (opts.maxTotalBytes !== undefined) {
    env.MAX_TOTAL_BYTES = String(opts.maxTotalBytes);
  }
  return makeTestApp(env, { dataDir }).app;
}

describe("/maps routes", () => {
  let scratch: tmp.DirResult;
  let app: FastifyInstance;

  beforeEach(async () => {
    scratch = tmp.dirSync({ unsafeCleanup: true });
    app = makeApp(scratch.name);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    scratch.removeCallback();
  });

  async function create(
    bytes = "first map",
  ): Promise<{ id: string; writeKey: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/maps",
      headers: OCTETS,
      payload: Buffer.from(bytes),
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json().id, writeKey: res.json().write_key };
  }

  describe("POST /maps", () => {
    it("returns 201 with the id, the record and a write key", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/maps",
        headers: OCTETS,
        payload: Buffer.from("first map"),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
      expect(body.byte_size).toBe(9);
      // 32 random bytes, base64url: 256 bits.
      expect(body.write_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("gives every map its own write key", async () => {
      const a = await create();
      const b = await create();
      expect(a.writeKey).not.toBe(b.writeKey);
    });

    it("stores only a hash of the write key", async () => {
      const { writeKey } = await create();
      const db = new Database(path.join(scratch.name, "atlas.db"));
      const dump = JSON.stringify(db.prepare("SELECT * FROM maps").all());
      db.close();
      expect(dump).not.toContain(writeKey);
    });

    it("never exposes where the blob is stored", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/maps",
        headers: OCTETS,
        payload: Buffer.from("first map"),
      });
      expect(res.json()).not.toHaveProperty("blob_ref");
      expect(res.json()).not.toHaveProperty("write_key_hash");
      expect(res.body).not.toContain(scratch.name);
    });

    it("returns 415 for a body that is not octet-stream", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/maps",
        headers: { "content-type": "application/json" },
        payload: "{}",
      });
      expect(res.statusCode).toBe(415);
    });

    it("returns 413 when the body exceeds bodyLimit", async () => {
      const tiny = makeApp(scratch.name, { bodyLimit: 64 });
      await tiny.ready();
      const res = await tiny.inject({
        method: "POST",
        url: "/maps",
        headers: OCTETS,
        payload: Buffer.alloc(128, 0xff),
      });
      expect(res.statusCode).toBe(413);
      await tiny.close();
    });
  });

  describe("PUT /maps/:id", () => {
    it("returns 200 with the updated record for the key holder", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/maps",
        headers: OCTETS,
        payload: Buffer.from("v1"),
      });
      const { id, write_key: writeKey, created_at } = created.json();

      const res = await app.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: { ...OCTETS, ...bearer(writeKey) },
        payload: Buffer.from("version two"),
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.id).toBe(id);
      expect(updated.byte_size).toBe(11);
      expect(updated.created_at).toBe(created_at);
      expect(updated).not.toHaveProperty("write_key");
      expect(updated).not.toHaveProperty("blob_ref");
    });

    it("refuses a write with no key: 401, and the bytes stay", async () => {
      const { id, writeKey } = await create("original");

      const res = await app.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: OCTETS,
        payload: Buffer.from("defaced"),
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers["www-authenticate"]).toBe("Bearer");
      const read = await app.inject({
        method: "GET",
        url: `/maps/${id}/blob`,
        headers: bearer(writeKey),
      });
      expect(read.body).toBe("original");
    });

    it("refuses a header that is not a Bearer key: 401", async () => {
      const { id } = await create();
      const res = await app.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: { ...OCTETS, authorization: "Basic dXNlcjpwYXNz" },
        payload: Buffer.from("x"),
      });
      expect(res.statusCode).toBe(401);
    });

    it("refuses a wrong key: 403, and the bytes stay", async () => {
      const { id, writeKey } = await create("original");
      const other = await create("other map");

      const res = await app.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: { ...OCTETS, ...bearer(other.writeKey) },
        payload: Buffer.from("defaced"),
      });

      expect(res.statusCode).toBe(403);
      const read = await app.inject({
        method: "GET",
        url: `/maps/${id}/blob`,
        headers: bearer(writeKey),
      });
      expect(read.body).toBe("original");
    });

    it("refuses any key for a map stored before write keys: 403", async () => {
      const { id, writeKey } = await create("old map");
      const db = new Database(path.join(scratch.name, "atlas.db"));
      db.prepare("UPDATE maps SET write_key_hash = NULL WHERE id = ?").run(id);
      db.close();

      const res = await app.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: { ...OCTETS, ...bearer(writeKey) },
        payload: Buffer.from("x"),
      });

      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for a malformed id", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/maps/bad-id",
        headers: { ...OCTETS, ...bearer("k".repeat(43)) },
        payload: Buffer.from("x"),
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for an unknown id", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/maps/${UNKNOWN_ID}`,
        headers: { ...OCTETS, ...bearer("k".repeat(43)) },
        payload: Buffer.from("x"),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /maps/:id/blob (the owner's backup)", () => {
    it("returns the latest bytes to the key holder", async () => {
      const { id, writeKey } = await create("v1");
      await app.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: { ...OCTETS, ...bearer(writeKey) },
        payload: Buffer.from("v2"),
      });

      const res = await app.inject({
        method: "GET",
        url: `/maps/${id}/blob`,
        headers: bearer(writeKey),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toBe("v2");
    });

    it("refuses no key with 401 and a wrong key with 403", async () => {
      const { id } = await create();
      const other = await create();

      const none = await app.inject({ method: "GET", url: `/maps/${id}/blob` });
      const wrong = await app.inject({
        method: "GET",
        url: `/maps/${id}/blob`,
        headers: bearer(other.writeKey),
      });

      expect(none.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(403);
      expect(wrong.body).not.toContain("first map");
    });

    it("returns 404 for an unknown id", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/maps/${UNKNOWN_ID}/blob`,
        headers: bearer("k".repeat(43)),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /maps/:id", () => {
    function rows(table: string, id: string): number {
      const db = new Database(path.join(scratch.name, "atlas.db"), {
        readonly: true,
      });
      try {
        const column = table === "maps" ? "id" : "map_id";
        return (
          db
            .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
            .get(id) as { n: number }
        ).n;
      } finally {
        db.close();
      }
    }

    it("removes the map's row, its share tokens and its bytes for the key holder", async () => {
      const { id, writeKey } = await create("to delete");
      const db = new Database(path.join(scratch.name, "atlas.db"));
      db.prepare(
        `INSERT INTO share_tokens (token, map_id, mode, expires_at, created_at)
         VALUES (?, ?, 'read', NULL, ?)`,
      ).run("t".repeat(21), id, new Date().toISOString());
      db.close();
      expect(rows("share_tokens", id)).toBe(1);

      const res = await app.inject({
        method: "DELETE",
        url: `/maps/${id}`,
        headers: bearer(writeKey),
      });

      expect(res.statusCode).toBe(204);
      expect(rows("maps", id)).toBe(0);
      expect(rows("share_tokens", id)).toBe(0);
      expect(
        fs.existsSync(path.join(scratch.name, "blobs", `${id}.atlasdraw`)),
      ).toBe(false);
      const again = await app.inject({
        method: "GET",
        url: `/maps/${id}/blob`,
        headers: bearer(writeKey),
      });
      expect(again.statusCode).toBe(404);
    });

    it("refuses no key with 401 and a wrong key with 403, and the map stays", async () => {
      const { id } = await create();
      const other = await create();

      const none = await app.inject({ method: "DELETE", url: `/maps/${id}` });
      const wrong = await app.inject({
        method: "DELETE",
        url: `/maps/${id}`,
        headers: bearer(other.writeKey),
      });

      expect(none.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(403);
      expect(rows("maps", id)).toBe(1);
    });

    it("returns 404 for an unknown id and 400 for a malformed one", async () => {
      const unknown = await app.inject({
        method: "DELETE",
        url: `/maps/${UNKNOWN_ID}`,
        headers: bearer("k".repeat(43)),
      });
      const malformed = await app.inject({
        method: "DELETE",
        url: "/maps/nope",
        headers: bearer("k".repeat(43)),
      });
      expect(unknown.statusCode).toBe(404);
      expect(malformed.statusCode).toBe(400);
    });
  });

  it("has no route that returns a map's record without its key", async () => {
    const { id } = await create();
    const res = await app.inject({ method: "GET", url: `/maps/${id}` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("byte_size");
  });

  describe("the total-size cap", () => {
    it("refuses a new map that would pass the cap: 507", async () => {
      const capped = makeApp(scratch.name, { maxTotalBytes: 10 });
      await capped.ready();
      const first = await capped.inject({
        method: "POST",
        url: "/maps",
        headers: OCTETS,
        payload: Buffer.from("123456"),
      });
      const second = await capped.inject({
        method: "POST",
        url: "/maps",
        headers: OCTETS,
        payload: Buffer.from("123456"),
      });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(507);
      await capped.close();
    });

    it("counts a rewrite by its growth, not its whole size", async () => {
      const capped = makeApp(scratch.name, { maxTotalBytes: 10 });
      await capped.ready();
      const created = await capped.inject({
        method: "POST",
        url: "/maps",
        headers: OCTETS,
        payload: Buffer.from("12345678"),
      });
      const { id, write_key: writeKey } = created.json();

      const same = await capped.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: { ...OCTETS, ...bearer(writeKey) },
        payload: Buffer.from("87654321"),
      });
      const grown = await capped.inject({
        method: "PUT",
        url: `/maps/${id}`,
        headers: { ...OCTETS, ...bearer(writeKey) },
        payload: Buffer.from("12345678901"),
      });

      expect(same.statusCode).toBe(200);
      expect(grown.statusCode).toBe(507);
      await capped.close();
    });
  });

  it("leaves no temp file behind after a write", async () => {
    const { id, writeKey } = await create();
    await app.inject({
      method: "PUT",
      url: `/maps/${id}`,
      headers: { ...OCTETS, ...bearer(writeKey) },
      payload: Buffer.from("again"),
    });
    const files = fs.readdirSync(path.join(scratch.name, "blobs"));
    expect(files).toEqual([`${id}.atlasdraw`]);
  });
});
