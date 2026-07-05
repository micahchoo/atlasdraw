// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — graceful-shutdown test for the y-websocket handler
// (ISSUES.md Issue 8). Before this fix, registerYjsHandler had no way to
// drain connected clients — `docker compose stop` hard-killed every
// in-flight y-websocket session with no close frame. This forces that path
// directly: connect a real client, call the returned close(), and assert it
// receives a normal close (code 1001), not an abrupt reset.

import http from "http";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";

import { registerYjsHandler } from "../src/yjs-server";

let server: http.Server;
let port: number;
let yjsHandler: { close(): void };

beforeAll(async () => {
  server = http.createServer();
  yjsHandler = registerYjsHandler(server);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 10_000);

afterAll(() => {
  server.close();
});

describe("registerYjsHandler — graceful shutdown", () => {
  it("close() sends a normal close frame (1001) to connected clients instead of hard-killing them", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/yjs/shutdown-test-room`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const closeEvent = new Promise<{ code: number }>((resolve) => {
      ws.once("close", (code: number) => resolve({ code }));
    });

    yjsHandler.close();

    const { code } = await closeEvent;
    expect(code).toBe(1001);
  });
});
