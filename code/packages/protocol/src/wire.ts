// SPDX-License-Identifier: MIT
//
// Facts of the room wire that the relay and the client must agree on: the
// close codes, the size table and the shape of a room id. The relay
// (apps/realtime) and the editor (apps/atlas-app) both read them from here.
//
// The size table holds one promise: every record the client lets through
// fits in one message the relay accepts. A record is the largest value one
// key of the room doc holds (a raster image, a data layer's features, an
// image file of the drawing). A message carries one or more records plus
// framing, so each record cap leaves room under the message cap.

import { LIMITS } from "./limits.js";

const KiB = 1 << 10;
const MiB = 1 << 20;

/** Size limits of a room, in bytes unless the name says otherwise. */
export const ROOM_SIZE = {
  /** The largest WebSocket message the relay reads (MAX_MESSAGE_BYTES). */
  messageBytes: LIMITS.message,
  /** The largest room state the relay holds (MAX_ROOM_BYTES). */
  roomBytes: LIMITS.room,
  /**
   * What a client keeps free in each message it packs: the sync header, and
   * the Yjs structs and keys around its records.
   */
  frameBytes: LIMITS.frame,
  /** One raster layer's image. */
  rasterBytes: LIMITS.record.raster,
  /** One data layer's FeatureCollection, as the room doc encodes it. */
  featureBytes: LIMITS.record.features,
  /** One image file of the drawing, as bytes (Excalidraw's file cap). */
  imageBytes: LIMITS.record.image,
  /** The same file as the data URL the room doc holds. */
  imageDataUrlChars: Math.ceil((LIMITS.record.image * 4) / 3) + 128,
} as const;

/** A size table of the same shape: tests scale it down. */
export type RoomSize = { readonly [K in keyof typeof ROOM_SIZE]: number };

/**
 * Close codes the relay sends. All but `messageTooLarge` are refusals in the
 * application range; `messageTooLarge` is WebSocket's own, sent by `ws` for
 * a frame over `messageBytes`. A client that reads any of them stops
 * reconnecting: the same attempt gets the same answer.
 */
export const CLOSE = {
  /** The token is not the room's. */
  denied: 4403,
  /** Too many people in the room, or rooms on the relay. */
  full: 4409,
  /** The room would grow past `roomBytes`. */
  roomTooLarge: 4413,
  /** Too many connections or new rooms from one address. */
  limited: 4429,
  /** The relay's storage for rooms is full. */
  noSpace: 4507,
  /** One message was over `messageBytes`. */
  messageTooLarge: 1009,
} as const;

export type CloseCode = (typeof CLOSE)[keyof typeof CLOSE];

/** The reason of a size refusal: what was measured, and the cap. */
export function closeReason(what: string, size: number, cap: number): string {
  return `${what}: ${size} > ${cap}`;
}

/** The size and the cap in a reason `closeReason` made; null for any other. */
export function readCloseReason(
  reason: string,
): { what: string; size: number; cap: number } | null {
  const m = /^(.+): (\d+) > (\d+)$/.exec(reason);
  return m ? { what: m[1]!, size: Number(m[2]), cap: Number(m[3]) } : null;
}

const ROOM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True for a room id: a UUID as `crypto.randomUUID()` makes it. */
export function isRoomId(text: string): boolean {
  return ROOM_ID.test(text);
}

/** A byte count for a person: "812.0 KB", "16.0 MB". */
export function sizeText(bytes: number): string {
  return bytes < MiB
    ? `${(bytes / KiB).toFixed(1)} KB`
    : `${(bytes / MiB).toFixed(1)} MB`;
}
