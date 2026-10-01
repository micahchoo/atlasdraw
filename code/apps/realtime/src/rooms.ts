// SPDX-License-Identifier: AGPL-3.0-only
//
// The room server: one Y.Doc per room, synced to every connection with the
// y-websocket wire protocol (y-protocols sync + awareness).
//
// A client connects to `/yjs/<roomId>` and sends a token message first
// (@atlasdraw/protocol `roomTokenMessage`). The token is derived from the key
// in the room link (ADR-0014), so the room id alone grants nothing. The first connection to a room id that the store does not know
// claims it: the server stores SHA-256(token) as the room's verifier. Every
// later connection must present a token with the same hash.
//
// A refused connection is upgraded and then closed with a code, so the
// client can tell the user why. A WebSocket refused during the HTTP upgrade
// shows the page only a generic error.
//
// A room lives in memory while it has connections. Edits are saved to the
// store after a short delay and when the last connection closes; then the
// room leaves memory. The relay reads everything in a room doc.

import { createHash, timingSafeEqual } from "crypto";

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";

import { logger } from "./logger.js";

import type { RoomStore } from "./room-store.js";
import type http from "http";
import type { Duplex } from "stream";

/** Close codes the client reads (apps/atlas-app/src/state/room.ts). */
export const CLOSE_DENIED = 4403;
export const CLOSE_FULL = 4409;
export const CLOSE_TOO_LARGE = 4413;

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_TOKEN = 3;
const PING_INTERVAL_MS = 30_000;
const AUTH_TIMEOUT_MS = 10_000;

/** A room id is a UUID, as `crypto.randomUUID()` makes it. */
const ROOM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A token is 32 bytes in base64url without padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface RoomServerOptions {
  store: RoomStore;
  /** Rooms held in memory at one time. A connection over it is "full". */
  maxRooms?: number;
  /** Connections to one room. A connection over it is "full". */
  maxPeersPerRoom?: number;
  /** The largest message a client may send, in bytes. */
  maxMessageBytes?: number;
  /** The largest room state the store keeps, in bytes. */
  maxRoomBytes?: number;
  /** Delay between an edit and the save that follows it. */
  saveDelayMs?: number;
}

export interface RoomServer {
  /** Rooms in memory now. */
  rooms(): number;
  /** Open connections, over all rooms. */
  connections(): number;
  /** Save every room and close every connection. */
  close(): void;
}

interface Room {
  readonly name: string;
  readonly verifier: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  /** Connection → the awareness client ids it controls. */
  readonly conns: Map<WebSocket, Set<number>>;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

/** The token in a token message, or null when the message is not one. */
function readTokenMessage(message: Uint8Array): string | null {
  try {
    const decoder = decoding.createDecoder(message);
    if (decoding.readVarUint(decoder) !== MESSAGE_TOKEN) {
      return null;
    }
    const token = decoding.readVarString(decoder);
    return TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}

function verifierOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameVerifier(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Defaults, with the environment variables that change them. */
export function roomLimitsFromEnv(): Omit<RoomServerOptions, "store"> {
  return {
    maxRooms: positiveInt(process.env.MAX_ROOMS, 1000),
    maxPeersPerRoom: positiveInt(process.env.MAX_ROOM_SIZE, 50),
    maxMessageBytes: positiveInt(process.env.MAX_MESSAGE_BYTES, 16 << 20),
    maxRoomBytes: positiveInt(process.env.MAX_ROOM_BYTES, 64 << 20),
  };
}

/**
 * Serve rooms on `server` under `/yjs/`. Other upgrade paths are left alone.
 */
export function registerRoomServer(
  server: http.Server,
  options: RoomServerOptions,
): RoomServer {
  const {
    store,
    maxRooms = 1000,
    maxPeersPerRoom = 50,
    maxMessageBytes = 16 << 20,
    maxRoomBytes = 64 << 20,
    saveDelayMs = 2000,
  } = options;
  const rooms = new Map<string, Room>();
  let closed = false;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: maxMessageBytes,
  });

  const save = (room: Room): void => {
    if (room.saveTimer) {
      clearTimeout(room.saveTimer);
      room.saveTimer = null;
    }
    const state = Y.encodeStateAsUpdate(room.doc);
    if (state.byteLength > maxRoomBytes) {
      logger.warn(
        { room: room.name, bytes: state.byteLength },
        "room is over the size limit, not saved",
      );
      for (const conn of room.conns.keys()) {
        conn.close(CLOSE_TOO_LARGE, "room too large");
      }
      return;
    }
    try {
      store.save(room.name, { verifier: room.verifier, state });
    } catch (err) {
      logger.error({ err, room: room.name }, "room save failed");
    }
  };

  const send = (conn: WebSocket, message: Uint8Array): void => {
    if (conn.readyState !== WebSocket.OPEN) {
      return;
    }
    conn.send(message, (err) => {
      if (err) {
        conn.close();
      }
    });
  };

  const openRoom = (name: string, verifier: string): Room => {
    const doc = new Y.Doc();
    const stored = store.load(name);
    if (stored) {
      Y.applyUpdate(doc, stored.state);
    }
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);
    const room: Room = {
      name,
      verifier: stored?.verifier ?? verifier,
      doc,
      awareness,
      conns: new Map(),
      saveTimer: null,
    };
    if (!stored) {
      // The claim is durable from the first connection, so a restart of the
      // relay does not free the room id for another token.
      store.save(name, { verifier, state: Y.encodeStateAsUpdate(doc) });
    }
    doc.on("update", (update: Uint8Array) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      for (const conn of room.conns.keys()) {
        send(conn, message);
      }
      if (!room.saveTimer) {
        room.saveTimer = setTimeout(() => save(room), saveDelayMs);
      }
    });
    awareness.on(
      "update",
      (
        {
          added,
          updated,
          removed,
        }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const controlled =
          origin instanceof WebSocket ? room.conns.get(origin) : undefined;
        if (controlled) {
          added.forEach((id) => controlled.add(id));
          removed.forEach((id) => controlled.delete(id));
        }
        const changed = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
        );
        const message = encoding.toUint8Array(encoder);
        for (const conn of room.conns.keys()) {
          send(conn, message);
        }
      },
    );
    rooms.set(name, room);
    return room;
  };

  const leave = (room: Room, conn: WebSocket): void => {
    const controlled = room.conns.get(conn);
    if (!controlled) {
      return;
    }
    room.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      room.awareness,
      Array.from(controlled),
      null,
    );
    if (room.conns.size === 0) {
      if (!closed) {
        save(room);
      }
      room.awareness.destroy();
      room.doc.destroy();
      rooms.delete(room.name);
    }
  };

  const join = (room: Room, conn: WebSocket): void => {
    room.conns.set(conn, new Set());
    conn.on("message", (data: ArrayBuffer) => {
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const encoder = encoding.createEncoder();
        switch (decoding.readVarUint(decoder)) {
          case MESSAGE_SYNC:
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn);
            if (encoding.length(encoder) > 1) {
              send(conn, encoding.toUint8Array(encoder));
            }
            break;
          case MESSAGE_AWARENESS:
            awarenessProtocol.applyAwarenessUpdate(
              room.awareness,
              decoding.readVarUint8Array(decoder),
              conn,
            );
            break;
        }
      } catch (err) {
        logger.warn({ err, room: room.name }, "bad message, connection closed");
        conn.close();
      }
    });

    let alive = true;
    conn.on("pong", () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (!alive) {
        conn.terminate();
        return;
      }
      alive = false;
      conn.ping();
    }, PING_INTERVAL_MS);
    conn.on("close", () => {
      clearInterval(ping);
      leave(room, conn);
    });

    // Sync step 1, then everyone's presence.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(conn, encoding.toUint8Array(encoder));
    const states = room.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(
          room.awareness,
          Array.from(states.keys()),
        ),
      );
      send(conn, encoding.toUint8Array(aw));
    }
  };

  /** Admit `ws` to room `name` with `token`, or close it with the reason. */
  const admit = (ws: WebSocket, name: string, token: string): void => {
    const verifier = verifierOf(token);
    let room = rooms.get(name);
    if (!room) {
      if (rooms.size >= maxRooms) {
        ws.close(CLOSE_FULL, "server full");
        return;
      }
      const stored = store.load(name);
      if (stored && !sameVerifier(stored.verifier, verifier)) {
        ws.close(CLOSE_DENIED, "denied");
        return;
      }
      room = openRoom(name, verifier);
    } else if (!sameVerifier(room.verifier, verifier)) {
      ws.close(CLOSE_DENIED, "denied");
      return;
    }
    if (room.conns.size >= maxPeersPerRoom) {
      ws.close(CLOSE_FULL, "room full");
      return;
    }
    join(room, ws);
  };

  server.on("upgrade", (request, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://relay");
    if (!url.pathname.startsWith("/yjs/")) {
      return;
    }
    const name = url.pathname.slice("/yjs/".length);
    if (!ROOM_ID.test(name)) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.binaryType = "arraybuffer";
      // The token is the first message, never part of the URL: a URL is
      // written to proxy access logs.
      const timer = setTimeout(
        () => ws.close(CLOSE_DENIED, "no token"),
        AUTH_TIMEOUT_MS,
      );
      ws.once("message", (data: ArrayBuffer) => {
        clearTimeout(timer);
        const token = readTokenMessage(new Uint8Array(data));
        if (token === null) {
          ws.close(CLOSE_DENIED, "no token");
          return;
        }
        admit(ws, name, token);
      });
    });
  });

  return {
    rooms: () => rooms.size,
    connections: () =>
      Array.from(rooms.values()).reduce((n, r) => n + r.conns.size, 0),
    close() {
      closed = true;
      for (const room of Array.from(rooms.values())) {
        save(room);
        for (const conn of room.conns.keys()) {
          conn.close(1001, "server shutting down");
        }
      }
      wss.close();
    },
  };
}
