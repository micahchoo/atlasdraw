// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — Phase 6 A2 comments Y.Doc routing tests.
//
// Verifies that the y-websocket upgrade handler (yjs-server.ts) correctly
// scopes Y.Docs by URL path so that:
//   1. Two clients on the same `/yjs/comments/${roomId}` URL see each other's
//      comment writes.
//   2. Workspace-scoped paths `/yjs/comments/${workspaceId}/${roomId}` are
//      isolated — workspace A's writes do not leak to workspace B.
//   3. The comments Y.Doc is distinct from the data-layer Y.Doc on the
//      same roomId (different docName = different document).
//
// Trust posture (ADR-0010): the relay holds plaintext comment Y.Docs by
// design. This test exercises the routing, not encryption.
//
// Plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A2

import http from "http";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Server as SocketIOServer } from "socket.io";
import * as Y from "yjs";
import { WebSocket } from "ws";

import {
  COMMENTS_ARRAY_KEY,
  COMMENT_SCHEMA_VERSION,
  buildCommentsDocPath,
  type CommentSchemaV1,
} from "@atlasdraw/protocol";

import { registerYjsHandler } from "../src/yjs-server";

let server: http.Server;
let io: SocketIOServer;
let port: number;

// ---------------------------------------------------------------------------
// Minimal y-websocket client — encodes sync step 1, receives updates, applies
// them to a local Y.Doc, and emits local changes to the server.
//
// Implemented inline so the test does not need to import y-websocket's client
// (which would require atlas-app to also depend on it; here we exercise the
// raw wire to prove the server routing works).
// ---------------------------------------------------------------------------

// y-protocols message types (from y-protocols/sync). Inlined to avoid a new
// dep here — the constants are stable wire-protocol numbers, not API surface.
const MESSAGE_SYNC = 0;
const MESSAGE_SYNC_STEP_1 = 0;
const MESSAGE_SYNC_STEP_2 = 1;
const MESSAGE_SYNC_UPDATE = 2;

function readVarUint(buf: Uint8Array, offset: number): [number, number] {
  let num = 0;
  let shift = 0;
  let i = offset;
  while (true) {
    const byte = buf[i++]!;
    num |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [num, i];
    }
    shift += 7;
  }
}

function writeVarUint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v & 0x7f);
  return out;
}

function encodeSyncMessage(subtype: number, payload: Uint8Array): Uint8Array {
  const header = [
    ...writeVarUint(MESSAGE_SYNC),
    ...writeVarUint(subtype),
    ...writeVarUint(payload.length),
  ];
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

interface YClient {
  doc: Y.Doc;
  ws: WebSocket;
  ready: Promise<void>;
  close: () => void;
}

function openClient(path: string): YClient {
  const doc = new Y.Doc();
  const ws = new WebSocket(`ws://localhost:${port}${path}`);
  ws.binaryType = "arraybuffer";

  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  let initialSyncSeen = false;

  ws.on("open", () => {
    // Sync step 1: send our state vector. The server replies with step 2
    // (the missing updates) and we're caught up.
    const sv = Y.encodeStateVector(doc);
    ws.send(encodeSyncMessage(MESSAGE_SYNC_STEP_1, sv));
  });

  ws.on("message", (buf: ArrayBuffer | Buffer) => {
    const u8 =
      buf instanceof ArrayBuffer
        ? new Uint8Array(buf)
        : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let [msgType, off] = readVarUint(u8, 0);
    if (msgType !== MESSAGE_SYNC) {
      return;
    } // ignore awareness etc.
    let subtype: number;
    [subtype, off] = readVarUint(u8, off);
    const [len, payloadOff] = readVarUint(u8, off);
    const payload = u8.subarray(payloadOff, payloadOff + len);

    if (subtype === MESSAGE_SYNC_STEP_1) {
      // Server requested our state — reply with step 2 (diff vs their vector).
      const diff = Y.encodeStateAsUpdate(doc, payload);
      ws.send(encodeSyncMessage(MESSAGE_SYNC_STEP_2, diff));
    } else if (
      subtype === MESSAGE_SYNC_STEP_2 ||
      subtype === MESSAGE_SYNC_UPDATE
    ) {
      Y.applyUpdate(doc, payload, "remote");
      if (!initialSyncSeen) {
        initialSyncSeen = true;
        resolveReady();
      }
    }
  });

  // Local updates → broadcast to server.
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") {
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeSyncMessage(MESSAGE_SYNC_UPDATE, update));
    }
  });

  // After socket open, the server immediately sends its step 1 too — but if
  // it does not (empty doc), we still want `ready` to resolve. Resolve on a
  // short tick after open as a fallback so test flows work for empty docs.
  ws.on("open", () => {
    setTimeout(() => {
      if (!initialSyncSeen) {
        initialSyncSeen = true;
        resolveReady();
      }
    }, 50);
  });

  return {
    doc,
    ws,
    ready,
    close: () => {
      ws.close();
      doc.destroy();
    },
  };
}

function makeComment(text: string, authorId: string): CommentSchemaV1 {
  return {
    id: `c-${Math.random().toString(36).slice(2, 10)}`,
    authorId,
    authorName: "Test User",
    text,
    createdAt: Date.now(),
    anchor: { kind: "map", lng: 0, lat: 0 },
    resolved: false,
    schemaVersion: COMMENT_SCHEMA_VERSION,
  };
}

function appendComment(doc: Y.Doc, c: CommentSchemaV1): void {
  const arr = doc.getArray<Y.Map<unknown>>(COMMENTS_ARRAY_KEY);
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(c)) {
    if (k === "anchor") {
      const a = new Y.Map<unknown>();
      for (const [ak, av] of Object.entries(v as object)) {
        a.set(ak, av);
      }
      m.set("anchor", a);
    } else {
      m.set(k, v);
    }
  }
  arr.push([m]);
}

function readComments(doc: Y.Doc): CommentSchemaV1[] {
  const arr = doc.getArray<Y.Map<unknown>>(COMMENTS_ARRAY_KEY);
  return arr.toArray().map((m) => {
    const a = m.get("anchor") as Y.Map<unknown> | undefined;
    const anchor =
      a !== undefined
        ? (Object.fromEntries(a.entries()) as CommentSchemaV1["anchor"])
        : ({ kind: "map", lng: 0, lat: 0 } as CommentSchemaV1["anchor"]);
    return {
      id: m.get("id") as string,
      authorId: m.get("authorId") as string,
      authorName: m.get("authorName") as string,
      text: m.get("text") as string,
      createdAt: m.get("createdAt") as number,
      anchor,
      resolved: m.get("resolved") as boolean,
      schemaVersion: m.get("schemaVersion") as 1,
    };
  });
}

async function waitFor<T>(
  fn: () => T | null | undefined,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = fn();
    if (
      v !== null &&
      v !== undefined &&
      (Array.isArray(v) ? v.length > 0 : true)
    ) {
      return v;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

beforeAll(async () => {
  server = http.createServer();
  io = new SocketIOServer(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket"],
  });
  registerYjsHandler(server);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 10_000);

afterAll(() => {
  io.close();
  server.close();
});

describe("comments y-websocket routing", () => {
  it("two clients on the same comments room see each other's writes", async () => {
    const path = buildCommentsDocPath("room-shared", null);
    const a = openClient(path);
    const b = openClient(path);
    await Promise.all([a.ready, b.ready]);

    appendComment(a.doc, makeComment("hello", "socket-a"));

    const seen = await waitFor(() => {
      const comments = readComments(b.doc);
      return comments.length > 0 ? comments : null;
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.text).toBe("hello");
    expect(seen[0]?.authorId).toBe("socket-a");

    a.close();
    b.close();
  });

  it("workspace-scoped paths are isolated", async () => {
    const pathA = buildCommentsDocPath("room-iso", "ws-alpha");
    const pathB = buildCommentsDocPath("room-iso", "ws-beta");
    const a = openClient(pathA);
    const b = openClient(pathB);
    await Promise.all([a.ready, b.ready]);

    appendComment(a.doc, makeComment("alpha-secret", "socket-a"));

    // Give the network a chance to propagate (if it would — it shouldn't).
    await new Promise((r) => setTimeout(r, 300));
    expect(readComments(b.doc)).toHaveLength(0);

    // And the writer's own doc sees its write.
    expect(readComments(a.doc)).toHaveLength(1);

    a.close();
    b.close();
  });

  it("comments doc is distinct from data-layer doc on the same roomId", async () => {
    const commentsPath = buildCommentsDocPath("room-distinct", null);
    const dataPath = `/yjs/room-distinct`;
    const a = openClient(commentsPath);
    const b = openClient(dataPath);
    await Promise.all([a.ready, b.ready]);

    appendComment(a.doc, makeComment("only-on-comments", "socket-a"));

    await new Promise((r) => setTimeout(r, 300));
    // Data-layer client uses the same array key opportunistically — should
    // remain empty since it's on a different docName.
    expect(b.doc.getArray(COMMENTS_ARRAY_KEY).length).toBe(0);

    a.close();
    b.close();
  });
});
