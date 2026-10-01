// SPDX-License-Identifier: AGPL-3.0-only
//
// The relay as it runs: `src/index.ts` in its own process, with its default
// limits. A frame that `ws` refuses (too large, or a text frame that is not
// UTF-8) must close that one socket and nothing else. Before 2026-10-01 it
// emitted "error" on a socket with no listener, and the process exited.

import { spawn, type ChildProcess } from "child_process";
import { randomBytes, randomUUID } from "crypto";
import net from "net";
import { fileURLToPath } from "url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { roomTokenMessage, withRoomToken } from "@atlasdraw/protocol";

const RELAY_DIR = fileURLToPath(new URL("..", import.meta.url));
/** One byte over the default message cap (16 MiB) and then some. */
const OVERSIZE = 17 << 20;

let relay: ChildProcess;
let port: number;
let exitCode: number | null = null;
let log = "";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const { port: p } = server.address() as net.AddressInfo;
      server.close(() => resolve(p));
    });
  });
}

async function until(what: string, cond: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(cond(), `not within ${ms}ms: ${what}\nrelay log:\n${log}`).toBe(true);
}

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  port = await freePort();
  relay = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: RELAY_DIR,
    env: { ...process.env, PORT: String(port), ROOMS_DB: ":memory:" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  relay.stdout!.on("data", (d) => (log += d));
  relay.stderr!.on("data", (d) => (log += d));
  relay.on("exit", (code) => (exitCode = code ?? -1));
  const start = Date.now();
  while (!(await healthy())) {
    if (exitCode !== null || Date.now() - start > 15_000) {
      throw new Error(`the relay did not start:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}, 20_000);

afterAll(async () => {
  if (exitCode === null) {
    const exited = new Promise((r) => relay.once("exit", r));
    relay.kill("SIGTERM");
    await exited;
  }
});

/** A raw socket to a room, open. */
async function rawSocket(room = randomUUID()): Promise<{
  ws: WebSocket;
  closed: Promise<{ code: number; reason: string }>;
}> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/yjs/${room}`);
  // A peer that sends too much is closed by the relay; the client side may
  // see its own write fail with EPIPE or ECONNRESET. Neither is the test.
  ws.on("error", () => {});
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, closed };
}

function provider(room: string, tok: string) {
  const doc = new Y.Doc();
  const p = new WebsocketProvider(`ws://127.0.0.1:${port}/yjs`, room, doc, {
    disableBc: true,
    WebSocketPolyfill: withRoomToken(
      WebSocket as unknown as typeof globalThis.WebSocket,
      tok,
    ),
  });
  return { doc, p };
}

describe("the relay process survives a bad frame", () => {
  it("closes an unauthenticated 17 MiB frame with 1009, and keeps serving", async () => {
    const { ws, closed } = await rawSocket();
    ws.send(new Uint8Array(OVERSIZE));
    expect((await closed).code).toBe(1009);

    await new Promise((r) => setTimeout(r, 200));
    expect(exitCode, log).toBeNull();
    expect(await healthy()).toBe(true);
  });

  it("closes a text frame that is not UTF-8 with 1007, and keeps serving", async () => {
    const { ws, closed } = await rawSocket();
    ws.send(Buffer.from([0xff, 0xfe, 0xfd]), { binary: false });
    expect((await closed).code).toBe(1007);

    await new Promise((r) => setTimeout(r, 200));
    expect(exitCode, log).toBeNull();
    expect(await healthy()).toBe(true);
  });

  it("closes an oversize frame from a joined client; other rooms keep syncing", async () => {
    const other = randomUUID();
    const tok = randomBytes(32).toString("base64url");
    const a = provider(other, tok);
    const b = provider(other, tok);
    try {
      await until("both are synced", () => a.p.synced && b.p.synced);

      const { ws, closed } = await rawSocket();
      ws.send(roomTokenMessage(randomBytes(32).toString("base64url")));
      await new Promise((r) => setTimeout(r, 100));
      ws.send(new Uint8Array(OVERSIZE));
      expect((await closed).code).toBe(1009);

      a.doc.getMap("meta").set("title", "after the bad frame");
      await until(
        "B sees A's edit",
        () => b.doc.getMap("meta").get("title") === "after the bad frame",
      );
      expect(exitCode, log).toBeNull();
      expect(await healthy()).toBe(true);
    } finally {
      a.p.destroy();
      b.p.destroy();
    }
  });
});
