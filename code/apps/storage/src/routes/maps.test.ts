import Fastify, { type FastifyInstance } from "fastify";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteFsAdapter } from "../adapters/sqlite-fs";
import { registerMapRoutes } from "./maps";

describe("/maps routes", () => {
  let scratch: tmp.DirResult;
  let app: FastifyInstance;

  beforeEach(async () => {
    scratch = tmp.dirSync({ unsafeCleanup: true });
    app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
    app.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body),
    );
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    registerMapRoutes(app, client);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    scratch.removeCallback();
  });

  it("POST /maps returns 201 with a MapRecord", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/maps",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("first map"),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(body.byte_size).toBe(9);
  });

  it("GET /maps/:id returns 400 for malformed id", async () => {
    const res = await app.inject({ method: "GET", url: "/maps/not-a-nanoid" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /maps/:id returns 404 for unknown id (well-formed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/maps/${"a".repeat(21)}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /maps/:id returns 200 for an existing map", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/maps",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("payload"),
    });
    const created = create.json();
    const res = await app.inject({
      method: "GET",
      url: `/maps/${created.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(created);
  });

  it("PUT /maps/:id returns 400 for malformed id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/maps/bad-id",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("x"),
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /maps/:id returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/maps/${"a".repeat(21)}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("x"),
    });
    expect(res.statusCode).toBe(404);
  });

  it("PUT /maps/:id returns 200 with the updated record", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/maps",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("v1"),
    });
    const created = create.json();
    const res = await app.inject({
      method: "PUT",
      url: `/maps/${created.id}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("version two"),
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.id).toBe(created.id);
    expect(updated.byte_size).toBe(11);
    expect(updated.created_at).toBe(created.created_at);
  });

  it("POST /maps returns 413 when body exceeds bodyLimit", async () => {
    // Use a tiny-limit instance for this case so we don't allocate 50 MiB.
    const tiny = Fastify({ logger: false, bodyLimit: 64 });
    tiny.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body),
    );
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    registerMapRoutes(tiny, client);
    await tiny.ready();

    const res = await tiny.inject({
      method: "POST",
      url: "/maps",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.alloc(128, 0xff),
    });
    expect(res.statusCode).toBe(413);
    await tiny.close();
  });
});
