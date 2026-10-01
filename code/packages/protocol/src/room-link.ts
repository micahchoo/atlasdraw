// SPDX-License-Identifier: MIT
//
// The room link: `#room:<roomId>,<secret>`. The fragment never reaches a
// server. The secret is 32 random bytes in base64url (ADR-0008, ADR-0014).
//
// The relay never sees the secret. A client derives a room token from it,
// one-way (HKDF-SHA256, salt = the room id, info = TOKEN_LABEL), and sends the
// token as the first message on the room's WebSocket. The relay accepts a
// connection only with the token the room was created with, so the room id
// alone grants nothing.

/** A parsed room link. */
export interface RoomLink {
  /** A UUID. */
  readonly roomId: string;
  /** 32 bytes, base64url without padding. */
  readonly secret: string;
}

const PREFIX = "room:";
const TOKEN_LABEL = "atlasdraw-room-auth";
/** The y-websocket message types are 0 (sync), 1 (awareness), 2 (auth). */
const MESSAGE_TOKEN = 3;

const ROOM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** A link to a new room. */
export function newRoomLink(): RoomLink {
  return {
    roomId: crypto.randomUUID(),
    secret: toBase64url(crypto.getRandomValues(new Uint8Array(32))),
  };
}

/** The URL fragment for a link, with its `#`. */
export function roomFragment(link: RoomLink): string {
  return `#${PREFIX}${link.roomId},${link.secret}`;
}

/** The link in a URL fragment, with or without its `#`; null if none. */
export function parseRoomLink(hash: string): RoomLink | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(PREFIX)) {
    return null;
  }
  const [roomId, secret, ...rest] = raw.slice(PREFIX.length).split(",");
  if (
    rest.length > 0 ||
    !ROOM_ID.test(roomId ?? "") ||
    !SECRET.test(secret ?? "")
  ) {
    return null;
  }
  return { roomId: roomId!, secret: secret! };
}

/** The token a client presents to the relay for this room. */
export async function roomToken(link: RoomLink): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64url(link.secret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(link.roomId),
      info: new TextEncoder().encode(TOKEN_LABEL),
    },
    key,
    256,
  );
  return toBase64url(new Uint8Array(bits));
}

/** The first message on a room socket: the type, then the token. */
export function roomTokenMessage(token: string): Uint8Array {
  const bytes = new TextEncoder().encode(token);
  if (bytes.length > 127) {
    throw new Error("room token too long");
  }
  // lib0 encoding: a varuint type, then a varstring (varuint length, UTF-8).
  return new Uint8Array([MESSAGE_TOKEN, bytes.length, ...bytes]);
}

/** The token in a token message, or null when the message is not one. */
export function readRoomTokenMessage(message: Uint8Array): string | null {
  if (message.length < 2 || message[0] !== MESSAGE_TOKEN) {
    return null;
  }
  const length = message[1]!;
  if (length > 127 || message.length !== 2 + length) {
    return null;
  }
  return new TextDecoder().decode(message.subarray(2));
}

/**
 * A WebSocket class whose sockets send the token message as soon as they
 * open. A y-websocket provider takes it as `WebSocketPolyfill`: the listener
 * added here runs before the provider's own `onopen`, which sends sync
 * step 1, so the relay reads the token first.
 */
export function withRoomToken(
  Base: typeof WebSocket,
  token: string,
): typeof WebSocket {
  const message = roomTokenMessage(token);
  return class RoomSocket extends Base {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("open", () => this.send(message));
    }
  };
}
