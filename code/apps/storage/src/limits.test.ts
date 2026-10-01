// What a client can hold on the server: memory, time and request slots.
// Each test runs the production app on a real port, because the attacks are
// about sockets: a reader that never reads, a body that never ends.
//
// The memory test collects garbage before each measurement, so it measures
// what is retained, not garbage that has not been collected yet.

import * as net from "node:net";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

import { OCTETS, bearer, makeTestApp } from "./test-support";

import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

const MiB = 1024 * 1024;

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  return (app.server.address() as AddressInfo).port;
}

/** A map of `size` bytes and a share token that reads it. */
async function sharedMap(
  app: FastifyInstance,
  size: number,
): Promise<{ token: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/maps",
    headers: OCTETS,
    payload: Buffer.alloc(size, 1),
  });
  expect(created.statusCode).toBe(201);
  const { id, write_key: key } = created.json();
  const shared = await app.inject({
    method: "POST",
    url: `/maps/${id}/share`,
    headers: bearer(key),
  });
  return { token: shared.json().token };
}

/** A socket that sends one GET and then never reads the answer. */
function stalledReader(port: number, path: string): net.Socket {
  const socket = net.connect(port, "127.0.0.1");
  socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`);
  socket.pause();
  return socket;
}

/** Resolves with the ms until the server closes `socket`, or rejects. */
function closedWithin(socket: net.Socket, ms: number): Promise<number> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`socket still open after ${ms} ms`)),
      ms,
    );
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(Date.now() - started);
    });
    socket.on("error", () => undefined);
  });
}

// `gc` without --expose-gc on the command line: the flag set at run time
// shows the function in a new context.
setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

function retained(): number {
  gc();
  gc();
  const mem = process.memoryUsage();
  return mem.arrayBuffers + mem.heapUsed;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("limits on what a client holds", () => {
  const sockets: net.Socket[] = [];
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    for (const s of sockets.splice(0)) {
      s.destroy();
    }
    for (const app of apps.splice(0)) {
      await app.close();
    }
  });

  it("keeps memory bounded while many readers stall on a large share blob", async () => {
    const readers = 16;
    const size = 32 * MiB;
    const t = makeTestApp({
      MAX_CONCURRENT_PER_IP: String(readers * 2),
      IDLE_TIMEOUT_MS: "60000",
    });
    apps.push(t.app);
    const { token } = await sharedMap(t.app, size);
    const port = await listen(t.app);
    const before = retained();

    for (let i = 0; i < readers; i++) {
      sockets.push(stalledReader(port, `/share/${token}/blob`));
    }
    // Long enough for every reader to fill its socket buffers and stall.
    await sleep(1500);
    const held = retained() - before;

    // Whole-blob reads would hold readers x size = 512 MiB here.
    expect(held).toBeLessThan(48 * MiB);
  }, 20_000);

  it("closes a connection whose body stops arriving", async () => {
    const t = makeTestApp({ IDLE_TIMEOUT_MS: "300" });
    apps.push(t.app);
    const port = await listen(t.app);

    const socket = net.connect(port, "127.0.0.1");
    sockets.push(socket);
    socket.write(
      "POST /maps HTTP/1.1\r\nHost: x\r\n" +
        "Content-Type: application/octet-stream\r\nContent-Length: 1000\r\n\r\n" +
        "only ten b",
    );

    expect(await closedWithin(socket, 3000)).toBeGreaterThanOrEqual(250);
  });

  it("closes a reader that stops reading", async () => {
    const t = makeTestApp({ IDLE_TIMEOUT_MS: "300" });
    apps.push(t.app);
    const { token } = await sharedMap(t.app, 32 * MiB);
    const port = await listen(t.app);

    // A paused client never reads the close, so watch the server's side.
    const accepted = new Promise<net.Socket>((resolve) =>
      t.app.server.once("connection", resolve),
    );
    sockets.push(stalledReader(port, `/share/${token}/blob`));

    const serverSide = await accepted;
    await closedWithin(serverSide, 5000);
    // It stalled long before the whole blob was sent.
    expect(serverSide.bytesWritten).toBeLessThan(32 * MiB);
  }, 10_000);

  it("refuses a client's request past its limit in flight, and frees the slot when one ends", async () => {
    const t = makeTestApp({
      MAX_CONCURRENT_PER_IP: "2",
      IDLE_TIMEOUT_MS: "60000",
    });
    apps.push(t.app);
    const { token } = await sharedMap(t.app, 32 * MiB);
    const port = await listen(t.app);
    const url = `http://127.0.0.1:${port}/share/${token}/blob`;

    const first = stalledReader(port, `/share/${token}/blob`);
    const second = stalledReader(port, `/share/${token}/blob`);
    sockets.push(first, second);
    await sleep(300);

    const third = await fetch(url, { method: "HEAD" });
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    // /health is never refused.
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);

    first.destroy();
    await sleep(200);
    const fourth = await fetch(url, { method: "HEAD" });
    expect(fourth.status).toBe(200);
  }, 10_000);
});
