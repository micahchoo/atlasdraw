// The composed app: what only exists once the parts are put together. The
// error handler, the health answer, the request log, the limiter key and the
// shutdown order. Real SQLite store; a fake store only where a fault is the
// point of the test.

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteFsAdapter } from "./adapters/sqlite-fs";
import { OCTETS, bearer, makeTestApp } from "./test-support";

import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import type { StorageClient } from "./types";

const SECRET = 'password authentication failed for user "postgres"';

/** A store whose every call fails with a message that must stay private. */
function failingClient(): StorageClient {
  const fail = async () => {
    throw new Error(SECRET);
  };
  return new Proxy({} as StorageClient, {
    get: (_t, prop) => (prop === "close" ? async () => undefined : fail),
  });
}

describe("buildApp", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) {
      await app.close();
    }
  });

  it("answers a 500 with a generic message and logs the detail", async () => {
    const t = makeTestApp({}, { client: failingClient() });
    apps.push(t.app);

    const res = await t.app.inject({
      method: "POST",
      url: "/maps",
      headers: OCTETS,
      payload: Buffer.from("x"),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal error" });
    expect(res.body).not.toContain("password");
    expect(t.log.text()).toContain("password authentication failed");
  });

  it("answers a failed /health with no error text", async () => {
    const t = makeTestApp({}, { client: failingClient() });
    apps.push(t.app);

    const res = await t.app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe("error");
    expect(res.body).not.toContain("password");
    expect(t.log.text()).toContain("password authentication failed");
  });

  it("never writes a share token to the log", async () => {
    const t = makeTestApp();
    apps.push(t.app);
    const created = await t.app.inject({
      method: "POST",
      url: "/maps",
      headers: OCTETS,
      payload: Buffer.from("shared"),
    });
    const { id, write_key: key } = created.json();
    const shared = await t.app.inject({
      method: "POST",
      url: `/maps/${id}/share`,
      headers: bearer(key),
    });
    const { token } = shared.json();

    const read = await t.app.inject({
      method: "GET",
      url: `/share/${token}/blob`,
    });

    expect(read.statusCode).toBe(200);
    expect(t.log.text()).toContain("/share/[redacted]/blob");
    expect(t.log.text()).not.toContain(token);
    expect(t.log.text()).not.toContain(key);
  });

  it("rate-limits an IPv6 client by its /64, not by its full address", async () => {
    const t = makeTestApp({ RATE_LIMIT_MAX: "1" });
    apps.push(t.app);
    const from = (remoteAddress: string) =>
      t.app.inject({ method: "GET", url: "/maps/x/blob", remoteAddress });

    const first = await from("2001:db8:1:2::1");
    const sameNet = await from("2001:db8:1:2:ffff::9");
    const otherNet = await from("2001:db8:1:3::1");

    expect(first.statusCode).not.toBe(429);
    expect(sameNet.statusCode).toBe(429);
    expect(otherNet.statusCode).not.toBe(429);
  });

  it("drains a request in flight before it closes the store", async () => {
    const t = makeTestApp();
    const created = await t.app.inject({
      method: "POST",
      url: "/maps",
      headers: OCTETS,
      payload: Buffer.from("old"),
    });
    const { id, write_key: key } = created.json();
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = t.app.server.address() as AddressInfo;

    // A PUT whose body is half sent when the shutdown starts.
    const body = Buffer.alloc(4 * 1024 * 1024, 7);
    const answer = new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "PUT",
          path: `/maps/${id}`,
          headers: {
            ...OCTETS,
            ...bearer(key),
            "content-length": String(body.length),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.write(body.subarray(0, body.length / 2));
      setTimeout(() => req.end(body.subarray(body.length / 2)), 100);
    });
    await new Promise((r) => setTimeout(r, 30));
    const started = Date.now();
    const closed = t.app.close();

    expect(await answer).toBe(200);
    await closed;
    // A keep-alive client does not hold the shutdown open.
    expect(Date.now() - started).toBeLessThan(2000);

    // The row and the blob it names agree.
    const store = createSqliteFsAdapter({ dataDir: t.dataDir });
    const map = await store.getMap(id);
    expect(map?.byte_size).toBe(body.length);
    const onDisk = fs.statSync(path.join(t.dataDir, map!.blob_ref)).size;
    expect(onDisk).toBe(body.length);
    await store.close();
  });
});
