// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import {
  newRoomLink,
  parseRoomLink,
  readRoomTokenMessage,
  roomFragment,
  roomToken,
  roomTokenMessage,
  withRoomToken,
} from "./room-link.js";

const ROOM = "3e1915ed-5afb-4706-a6af-f600f29cde94";
const SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"; // bytes 0..31

describe("room link", () => {
  it("survives the fragment round trip", () => {
    const link = newRoomLink();
    expect(parseRoomLink(roomFragment(link))).toEqual(link);
    expect(roomFragment(link)).toBe(`#room:${link.roomId},${link.secret}`);
  });

  it("refuses fragments that are not room links", () => {
    for (const hash of [
      "",
      "#",
      `#${ROOM},${SECRET}`, // no room: prefix
      `#room:${ROOM}`, // no secret
      `#room:not-a-uuid,${SECRET}`,
      `#room:${ROOM},${SECRET.slice(1)}`, // 31 bytes
      `#room:${ROOM},${SECRET}!`,
    ]) {
      expect(parseRoomLink(hash), hash).toBeNull();
    }
  });

  it("accepts the hash with or without its #", () => {
    expect(parseRoomLink(`room:${ROOM},${SECRET}`)).toEqual({
      roomId: ROOM,
      secret: SECRET,
    });
  });
});

describe("room token", () => {
  it("is fixed for a link, and differs when the secret or the room differs", async () => {
    const link = { roomId: ROOM, secret: SECRET };
    const token = await roomToken(link);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await roomToken(link)).toBe(token);
    expect(await roomToken({ ...link, roomId: newRoomLink().roomId })).not.toBe(
      token,
    );
    expect(await roomToken({ ...link, secret: newRoomLink().secret })).not.toBe(
      token,
    );
  });

  it("is not the secret", async () => {
    const link = { roomId: ROOM, secret: SECRET };
    expect(await roomToken(link)).not.toBe(SECRET);
  });
});

describe("token message", () => {
  it("reads back the token it carries", () => {
    const token = SECRET;
    expect(readRoomTokenMessage(roomTokenMessage(token))).toBe(token);
  });

  it("reads nothing from a y-websocket sync message", () => {
    expect(readRoomTokenMessage(new Uint8Array([0, 0, 1, 0]))).toBeNull();
  });

  it("is the first thing a socket sends, before the provider's own open handler", () => {
    const sent: unknown[] = [];
    class FakeSocket extends EventTarget {
      onopen: (() => void) | null = null;
      constructor(
        readonly url: string,
        readonly protocols?: string | string[],
      ) {
        super();
      }
      send(data: unknown) {
        sent.push(data);
      }
      open() {
        this.dispatchEvent(new Event("open"));
        this.onopen?.();
      }
    }
    const Socket = withRoomToken(
      FakeSocket as unknown as typeof WebSocket,
      SECRET,
    );
    const ws = new Socket("ws://relay/yjs/x") as unknown as FakeSocket;
    ws.onopen = () => ws.send("sync step 1");
    ws.open();
    expect(readRoomTokenMessage(sent[0] as Uint8Array)).toBe(SECRET);
    expect(sent[1]).toBe("sync step 1");
  });
});
