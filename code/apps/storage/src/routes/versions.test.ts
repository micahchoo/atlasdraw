// A map's server versions, through the production app on SQLite
// (docs/architecture/adr/0020-server-version-history.md). Only the write
// key lists or reads them; a share token reads none of them.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OCTETS, bearer, makeTestApp } from "../test-support";

import type { FastifyInstance } from "fastify";

const UNKNOWN_ID = "a".repeat(21);

describe("server versions", () => {
  let app: FastifyInstance;

  /** An app that keeps every save, up to `kept` of them. */
  async function start(env: Record<string, string> = {}): Promise<void> {
    app = makeTestApp({
      MAP_VERSIONS_KEPT: "3",
      MAP_VERSION_INTERVAL_MINUTES: "0",
      ...env,
    }).app;
    await app.ready();
  }

  beforeEach(() => start());

  afterEach(async () => {
    await app.close();
  });

  async function create(bytes: string) {
    const res = await app.inject({
      method: "POST",
      url: "/maps",
      headers: OCTETS,
      payload: Buffer.from(bytes),
    });
    return { id: res.json().id as string, key: res.json().write_key as string };
  }

  function put(id: string, key: string, bytes: string, query = "") {
    return app.inject({
      method: "PUT",
      url: `/maps/${id}${query}`,
      headers: { ...OCTETS, ...bearer(key) },
      payload: Buffer.from(bytes),
    });
  }

  it("lists the map's revisions, newest first, the current one first", async () => {
    const { id, key } = await create("v1");
    await put(id, key, "v2");
    await put(id, key, "v3!");

    const res = await app.inject({
      method: "GET",
      url: `/maps/${id}/versions`,
      headers: bearer(key),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.current).toBe(3);
    expect(body.versions.map((v: { revision: number }) => v.revision)).toEqual([
      3, 2, 1,
    ]);
    expect(body.versions[0]).toEqual({
      revision: 3,
      saved_at: expect.any(String),
      byte_size: 3,
    });
    expect(JSON.stringify(body)).not.toContain("blob");
  });

  it("keeps no more than MAP_VERSIONS_KEPT earlier revisions", async () => {
    const { id, key } = await create("v1");
    for (const bytes of ["v2", "v3", "v4", "v5"]) {
      await put(id, key, bytes);
    }

    const res = await app.inject({
      method: "GET",
      url: `/maps/${id}/versions`,
      headers: bearer(key),
    });

    expect(
      res.json().versions.map((v: { revision: number }) => v.revision),
    ).toEqual([5, 4, 3, 2]);
  });

  it("gives the bytes of one revision, with its ETag", async () => {
    const { id, key } = await create("v1");
    await put(id, key, "v2");

    const old = await app.inject({
      method: "GET",
      url: `/maps/${id}/versions/1/blob`,
      headers: bearer(key),
    });
    const current = await app.inject({
      method: "GET",
      url: `/maps/${id}/versions/2/blob`,
      headers: bearer(key),
    });

    expect(old.statusCode).toBe(200);
    expect(old.body).toBe("v1");
    expect(old.headers.etag).toBe('"1"');
    expect(old.headers["content-disposition"]).toMatch(/^attachment/);
    expect(current.body).toBe("v2");
  });

  it("answers 404 for a revision the store does not keep, 400 for one that is not a number", async () => {
    const { id, key } = await create("v1");

    for (const [revision, status] of [
      ["9", 404],
      ["0", 400],
      ["x", 400],
      ["1.5", 400],
    ] as const) {
      const res = await app.inject({
        method: "GET",
        url: `/maps/${id}/versions/${revision}/blob`,
        headers: bearer(key),
      });
      expect(res.statusCode, revision).toBe(status);
    }
  });

  it("refuses no key with 401 and a wrong key with 403, for the list and the bytes", async () => {
    const { id } = await create("v1");
    const other = await create("other");

    for (const url of [`/maps/${id}/versions`, `/maps/${id}/versions/1/blob`]) {
      const none = await app.inject({ method: "GET", url });
      const wrong = await app.inject({
        method: "GET",
        url,
        headers: bearer(other.key),
      });
      expect(none.statusCode, url).toBe(401);
      expect(wrong.statusCode, url).toBe(403);
    }
    const unknown = await app.inject({
      method: "GET",
      url: `/maps/${UNKNOWN_ID}/versions`,
      headers: bearer(other.key),
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("a share token reads no version but the one it shows", async () => {
    const { id, key } = await create("v1");
    await put(id, key, "v2");
    const share = await app.inject({
      method: "POST",
      url: `/maps/${id}/share`,
      headers: bearer(key),
    });
    const token = share.json().token as string;

    const list = await app.inject({
      method: "GET",
      url: `/maps/${id}/versions`,
      headers: bearer(token),
    });

    expect(list.statusCode).toBe(403);
  });

  it("a checkpoint save keeps what it replaces, though the interval has not passed", async () => {
    await app.close();
    await start({ MAP_VERSION_INTERVAL_MINUTES: "60" });
    const { id, key } = await create("v1");
    await put(id, key, "v2");
    await put(id, key, "v3");

    const restored = await put(id, key, "v1", "?checkpoint=1");
    const res = await app.inject({
      method: "GET",
      url: `/maps/${id}/versions`,
      headers: bearer(key),
    });

    expect(restored.statusCode).toBe(200);
    expect(
      res.json().versions.map((v: { revision: number }) => v.revision),
    ).toEqual([4, 3, 1]);
  });

  it("refuses a checkpoint value it does not know: 400", async () => {
    const { id, key } = await create("v1");

    const res = await put(id, key, "v2", "?checkpoint=yes");

    expect(res.statusCode).toBe(400);
  });
});
