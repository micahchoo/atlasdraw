// SPDX-License-Identifier: AGPL-3.0-only
//
// A room's world frame passes the same check as a file's
// (documentGate.ts#worldProblem). Every element in the room is measured in
// the frame, so a joiner that guessed one would read and write every
// element in a different place from its peers. It refuses instead.

import { describe, expect, it, vi } from "vitest";

import { newRoomLink } from "@atlasdraw/protocol";

import { joinRoom, type RoomStatus, type RoomTransport } from "../room";

import type * as Y from "yjs";

const SCENE = { elements: () => [], files: () => ({}) };
const ID = "01HZ8KQR5Z3MV7BJ4N6XPYD9TF";

/** A transport whose room already holds `meta`, then reports it synced. */
function roomWith(meta: Record<string, unknown>) {
  const close = vi.fn();
  const transport: RoomTransport = ({ doc, events }) => {
    doc.transact(() => {
      const m = doc.getMap("meta");
      for (const [key, value] of Object.entries(meta)) {
        m.set(key, value);
      }
      doc.getMap("elements").set("peer-el", { id: "peer-el" });
    }, "peer");
    queueMicrotask(() => events.synced());
    return { close };
  };
  return { transport, close };
}

async function settled(room: ReturnType<typeof joinRoom>) {
  return new Promise<RoomStatus>((resolve) => {
    room.status((s) => {
      if (s !== "connecting") {
        resolve(s);
      }
    });
  });
}

describe("a room's world frame", () => {
  it("joins a room whose frame is valid", async () => {
    const { transport } = roomWith({
      id: ID,
      world: { z0: 22, origin: { x: 100, y: 200 } },
    });
    const room = joinRoom(newRoomLink(), transport, { scene: SCENE });
    expect(await settled(room)).toBe("joined");
    expect(room.document?.snapshot().world).toEqual({
      z0: 22,
      origin: { x: 100, y: 200 },
    });
    room.leave();
  });

  it("refuses a room whose frame has another reference zoom, and says why", async () => {
    const { transport, close } = roomWith({
      id: ID,
      world: { z0: 12, origin: { x: 0, y: 0 } },
    });
    const room = joinRoom(newRoomLink(), transport, { scene: SCENE });
    expect(await settled(room)).toBe("damaged");
    expect(room.reason).toMatch(/reference zoom is 12/);
    expect(room.document).toBeNull();
    expect(close).toHaveBeenCalled();
  });

  it("refuses a made room that lost its frame, and writes no new one", async () => {
    const { transport } = roomWith({ id: ID });
    const link = newRoomLink();
    const room = joinRoom(link, transport, { scene: SCENE });
    const doc: Y.Doc = room.doc;
    expect(await settled(room)).toBe("damaged");
    expect(room.reason).toMatch(/world frame/);
    expect(doc.getMap("meta").has("world")).toBe(false);
  });
});
