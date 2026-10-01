// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Making a room from a map (roomDocument.ts#planSeed, #writeSeed), against
// a size table smaller than the protocol's, so a few kilobytes stand in for
// the real megabytes. Each transaction is one message on the wire; the
// relay refuses a message over `messageBytes` and a room over `roomBytes`.
// collab.known-red.test.ts seeds a map over the real cap through a relay.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { ROOM_SIZE, type RoomSize } from "@atlasdraw/protocol";

import type { ExcalidrawElement } from "@atlasdraw/element/types";

import { createDocument, type Document } from "../document";
import { planSeed, writeSeed } from "../roomDocument";

const KiB = 1024;

/** The protocol's table, scaled from megabytes to kilobytes. */
const SMALL: RoomSize = {
  messageBytes: 16 * KiB,
  roomBytes: 64 * KiB,
  frameBytes: 1 * KiB,
  rasterBytes: 15 * KiB,
  featureBytes: 15 * KiB,
  imageBytes: 4 * KiB,
  imageDataUrlChars: Math.ceil((4 * KiB * 4) / 3) + 128,
};

const CORNERS: [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] = [
  [13.3, 52.6],
  [13.5, 52.6],
  [13.5, 52.4],
  [13.3, 52.4],
];

function rect(id: string): ExcalidrawElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
  } as unknown as ExcalidrawElement;
}

function mapWith(
  rasters: Record<string, number>,
  elements: ExcalidrawElement[] = [],
): Document {
  const d = createDocument(
    { title: "Survey" },
    { elements: () => elements, files: () => ({}) },
  );
  for (const [id, bytes] of Object.entries(rasters)) {
    d.dispatch({
      type: "add-raster-layer",
      id,
      label: id.slice(3),
      corners: CORNERS,
      imageKey: `${id}.png`,
      image: new Blob([new Uint8Array(bytes).fill(9)], { type: "image/png" }),
    });
  }
  return d;
}

describe("planSeed", () => {
  it("writes a map larger than one message as several, each within the cap", async () => {
    const elements = Array.from({ length: 200 }, (_, i) => rect(`r${i}`));
    const plan = await planSeed(
      mapWith(
        { "rl:a": 12 * KiB, "rl:b": 12 * KiB, "rl:c": 12 * KiB },
        elements,
      ),
      null,
      SMALL,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const doc = new Y.Doc();
    const messages: number[] = [];
    doc.on("update", (u: Uint8Array) => messages.push(u.byteLength));
    writeSeed(doc, plan, "seed");

    expect(messages.length).toBeGreaterThan(3);
    for (const bytes of messages) {
      expect(bytes).toBeLessThanOrEqual(SMALL.messageBytes);
    }
    expect(Array.from(doc.getMap("overlays").keys()).sort()).toEqual([
      "rl:a",
      "rl:b",
      "rl:c",
    ]);
    expect(doc.getMap("images").size).toBe(3);
    expect(doc.getMap("elements").size).toBe(200);
  });

  it("writes the frame first, so a joiner never sees a room without one", async () => {
    const plan = await planSeed(
      mapWith({ "rl:a": 12 * KiB, "rl:b": 12 * KiB }),
      null,
      SMALL,
    );
    if (!plan.ok) {
      throw new Error(plan.reason);
    }
    const doc = new Y.Doc();
    const worldAtEach: boolean[] = [];
    doc.on("afterTransaction", () =>
      worldAtEach.push(doc.getMap("meta").has("world")),
    );
    writeSeed(doc, plan, "seed");
    expect(worldAtEach.every(Boolean)).toBe(true);
  });

  it("refuses a layer over its record cap, naming its size and the cap", async () => {
    const plan = await planSeed(mapWith({ "rl:huge": 17 * KiB }), null, SMALL);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toMatch(/huge.*17\.0 KB.*15\.0 KB/);
  });

  it("refuses a map over the room cap, naming its size and the cap", async () => {
    const plan = await planSeed(
      mapWith({
        "rl:a": 14 * KiB,
        "rl:b": 14 * KiB,
        "rl:c": 14 * KiB,
        "rl:d": 14 * KiB,
        "rl:e": 14 * KiB,
      }),
      null,
      SMALL,
    );
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toMatch(/7\d\.\d KB.*64\.0 KB/);
  });

  it("uses the protocol's table when none is given", async () => {
    const plan = await planSeed(mapWith({ "rl:a": 17 * KiB }), null);
    expect(plan.ok).toBe(true);
    expect(ROOM_SIZE.rasterBytes).toBeGreaterThan(17 * KiB);
  });
});
