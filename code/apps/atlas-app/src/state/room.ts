// SPDX-License-Identifier: AGPL-3.0-only
//
// A room: one shared map, held in one Y.Doc that a relay keeps and syncs
// (docs/architecture/adr/0014-collab-trust-model.md). The room doc holds the
// drawing (roomScene.ts), the layers, title and frame (roomDocument.ts) and
// the comments (comments.ts).
// Presence (who is here, their cursor and camera) is Yjs awareness.
//
//   const room = joinRoom(link, relayTransport(url));
//   room.status((s) => ...);            // connecting → joined, or denied / full
//   room.document                       // the room's Document once joined
//   const detach = room.attach(editor)  // the editor shows the room's drawing
//   room.presence.setCursor({ lng, lat })
//   room.leave()
//
// A room has its own Document, one per room, with an id the room doc keeps
// (roomDocument.ts). Joining never changes
// the user's own map, and the autosave does not write a room's document
// (isRoomDocument).
//
// Undo stays Excalidraw's. A remote change reaches the editor with
// CaptureUpdateAction.NEVER, so Excalidraw's history holds only this
// user's own changes, as deltas; an undo is a new local edit with a higher
// version, and it reaches the room like any other edit.

import { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import {
  CLOSE,
  ROOM_SIZE,
  readCloseReason,
  roomToken,
  sizeText,
  withRoomToken,
  type RoomLink,
} from "@atlasdraw/protocol";

import type { Camera } from "@atlasdraw/data";

import { getAppConfig } from "../config/app-config";

import { MAX_NAME_LENGTH, localIdentity, type Identity } from "./identity";
import {
  bindRoomDocument,
  makeEmptyRoom,
  roomIsMade,
  writeSeed,
  type Seed,
} from "./roomDocument";
import { bindScene, type RoomEditor } from "./roomScene";

import { editorScene, type SceneAccess } from "./scene";

import type { Document } from "./document";

/**
 * Where the room stands. The last six are refusals: the relay closed the
 * connection with a reason, or the client found one before it connected,
 * and the room does not try again. A refusal after "joined" means the
 * edits made from then on reach nobody.
 *
 *   denied       the link's key is not the room's
 *   full         too many people in the room, or rooms on the relay
 *   too-large    one change was over the relay's message cap, or the room
 *                would grow past its cap (protocol ROOM_SIZE)
 *   limited      too many connections or new rooms from this network
 *   no-space     the relay's storage for rooms is full
 *   unavailable  this page cannot make a room token (no WebCrypto: an
 *                http page that is not localhost)
 */
export type RoomStatus =
  | "connecting"
  | "joined"
  | "offline"
  | "denied"
  | "full"
  | "too-large"
  | "limited"
  | "no-space"
  | "unavailable";

/** The status a refusal close code means; null for any other close. */
function refusal(code: number): RoomStatus | null {
  switch (code) {
    case CLOSE.denied:
      return "denied";
    case CLOSE.full:
      return "full";
    case CLOSE.roomTooLarge:
    case CLOSE.messageTooLarge:
      return "too-large";
    case CLOSE.limited:
      return "limited";
    case CLOSE.noSpace:
      return "no-space";
    default:
      return null;
  }
}

/** A size refusal in the user's words, with the size and the cap. */
function sizeRefusal(code: number, reason: string): string | null {
  if (code === CLOSE.messageTooLarge) {
    return `One change was larger than the server takes at once (${sizeText(
      ROOM_SIZE.messageBytes,
    )}).`;
  }
  if (code === CLOSE.roomTooLarge) {
    const sizes = readCloseReason(reason);
    return sizes
      ? `This shared map would grow to ${sizeText(
          sizes.size,
        )}; the server holds at most ${sizeText(sizes.cap)} per map.`
      : `This shared map is over the server's size limit.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface TransportEvents {
  /** The doc has had its first full sync from the relay since (re)connect. */
  synced(): void;
  /** The connection closed with this WebSocket close code and reason. */
  closed(code: number, reason: string): void;
}

/** How a room reaches its relay. */
export type RoomTransport = (args: {
  roomId: string;
  token: string;
  doc: Y.Doc;
  awareness: Awareness;
  events: TransportEvents;
}) => { close(): void };

/**
 * The transport this build uses: the configured relay, or the page's own
 * origin when no URL is set. Null when this build has no rooms.
 */
export function configuredTransport(): RoomTransport | null {
  const { realtime } = getAppConfig();
  return realtime.enabled
    ? relayTransport(realtime.wsUrl || window.location.origin)
    : null;
}

/**
 * The relay at `baseUrl` (http(s) or ws(s)), over the y-websocket protocol
 * at `/yjs/<roomId>`. The token is the first message (protocol
 * `withRoomToken`). A refused connection does not retry.
 */
export function relayTransport(baseUrl: string): RoomTransport {
  const url = `${baseUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/yjs`;
  return ({ roomId, token, doc, awareness, events }) => {
    const provider = new WebsocketProvider(url, roomId, doc, {
      awareness,
      // Tabs in one browser must sync through the relay, like everyone
      // else, or a tab could read a room the relay refused it.
      disableBc: true,
      WebSocketPolyfill: withRoomToken(WebSocket, token),
    });
    provider.on("sync", (synced: boolean) => {
      if (synced) {
        events.synced();
      }
    });
    provider.on("connection-close", (event: CloseEvent | null) => {
      const code = event?.code ?? 1006;
      if (refusal(code)) {
        // Before y-websocket schedules its next attempt: a refusal is the
        // same answer every time, so no retry.
        provider.shouldConnect = false;
      }
      events.closed(code, event?.reason ?? "");
    });
    return { close: () => provider.destroy() };
  };
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

export interface LngLat {
  readonly lng: number;
  readonly lat: number;
}

export interface Peer {
  /** The Yjs client id: one per tab. */
  readonly clientId: number;
  readonly user: Identity;
  readonly cursor: LngLat | null;
  readonly camera: Camera | null;
}

export interface Presence {
  /** This person, as the others see them. */
  readonly self: Identity;
  /** Show the others this name from now on. */
  setName(name: string): void;
  /** Everyone else in the room. The same array until something changes. */
  peers(): readonly Peer[];
  subscribe(listener: () => void): () => void;
  /** Where this user's pointer is on Earth; null when it left the map. */
  setCursor(at: LngLat | null): void;
  setCamera(camera: Camera): void;
}

const CURSOR_INTERVAL_MS = 50;

function isLngLat(v: unknown): v is LngLat {
  const p = v as LngLat | null;
  return (
    typeof p === "object" &&
    p !== null &&
    Number.isFinite(p.lng) &&
    Number.isFinite(p.lat)
  );
}

function isCamera(v: unknown): v is Camera {
  const c = v as Camera | null;
  return (
    typeof c === "object" &&
    c !== null &&
    Array.isArray(c.center) &&
    c.center.length === 2 &&
    c.center.every(Number.isFinite) &&
    Number.isFinite(c.zoom)
  );
}

/** A peer's state from awareness, which any client can write; or null. */
function peerOf(clientId: number, state: Record<string, unknown>): Peer | null {
  const user = state.user as Identity | undefined;
  if (
    typeof user !== "object" ||
    user === null ||
    typeof user.id !== "string" ||
    typeof user.name !== "string" ||
    typeof user.color !== "string" ||
    !/^#[0-9a-fA-F]{3,8}$/.test(user.color)
  ) {
    return null;
  }
  return {
    clientId,
    user: {
      id: user.id,
      name: user.name.slice(0, MAX_NAME_LENGTH),
      color: user.color,
    },
    cursor: isLngLat(state.cursor) ? state.cursor : null,
    camera: isCamera(state.camera) ? state.camera : null,
  };
}

function createPresence(awareness: Awareness, initial: Identity): Presence {
  let self = initial;
  awareness.setLocalState({ user: self, cursor: null, camera: null });
  let peers: readonly Peer[] = [];
  const listeners = new Set<() => void>();
  awareness.on("change", () => {
    const next: Peer[] = [];
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID) {
        return;
      }
      const peer = peerOf(clientId, state);
      if (peer) {
        next.push(peer);
      }
    });
    peers = next;
    for (const l of Array.from(listeners)) {
      l();
    }
  });

  // At most one cursor message per interval; the last position always goes.
  let lastSent = 0;
  let pending: LngLat | null | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const sendCursor = (): void => {
    timer = null;
    lastSent = Date.now();
    awareness.setLocalStateField("cursor", pending ?? null);
    pending = undefined;
  };

  return {
    get self() {
      return self;
    },
    setName(name) {
      const clean = name.trim().slice(0, MAX_NAME_LENGTH);
      if (!clean || clean === self.name) {
        return;
      }
      self = { ...self, name: clean };
      awareness.setLocalStateField("user", self);
    },
    peers: () => peers,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setCursor(at) {
      pending = at;
      if (timer) {
        return;
      }
      const wait = lastSent + CURSOR_INTERVAL_MS - Date.now();
      if (wait <= 0) {
        sendCursor();
      } else {
        timer = setTimeout(sendCursor, wait);
      }
    },
    setCamera(camera) {
      awareness.setLocalStateField("camera", camera);
    },
  };
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export interface Room {
  readonly link: RoomLink;
  /** The room doc. */
  readonly doc: Y.Doc;
  /** The room's Document; null until the room first joins. */
  readonly document: Document | null;
  readonly presence: Presence;
  /** Call `listener` with the status now and after each change. */
  status(listener: (status: RoomStatus) => void): () => void;
  /**
   * Why the room was refused, in the user's words, when the status alone
   * does not say it: the size and the cap of a size refusal. Null
   * otherwise.
   */
  readonly reason: string | null;
  /**
   * Show the room's drawing in `editor` and keep the two in step. Only
   * after the room joined. Returns the detach function.
   */
  attach(editor: RoomEditor): () => void;
  /** Disconnect and drop the room doc. The room stays on the relay. */
  leave(): void;
}

export interface JoinOptions {
  /**
   * The user's map, planned as a room (roomDocument.ts#planSeed), to make a
   * new room from. Used only when the room is empty: a room that exists
   * already keeps its content.
   */
  seed?: Seed;
  identity?: Identity;
  /** The drawing the room's Document saves with. Default: the editor's. */
  scene?: SceneAccess;
}

const roomDocuments = new WeakSet<Document>();

/** True for a room's Document: the autosave leaves it to the relay. */
export function isRoomDocument(doc: Document): boolean {
  return roomDocuments.has(doc);
}

export function joinRoom(
  link: RoomLink,
  transport: RoomTransport,
  options: JoinOptions = {},
): Room {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const presence = createPresence(
    awareness,
    options.identity ?? localIdentity(),
  );
  // The origin of every write this client makes to the room doc.
  const local = { room: link.roomId };

  let status: RoomStatus = "connecting";
  let reason: string | null = null;
  const listeners = new Set<(s: RoomStatus) => void>();
  const setStatus = (next: RoomStatus): void => {
    if (status === next) {
      return;
    }
    status = next;
    for (const l of Array.from(listeners)) {
      l(next);
    }
  };

  let document: Document | null = null;
  let unbindDocument: (() => void) | null = null;
  /** The room was made or seeded, or found made, at the first sync. */
  let made = false;
  let left = false;
  /** The relay refused this client; the status stays the refusal. */
  let refused = false;
  let connection: { close(): void } | null = null;

  const refuse = (next: RoomStatus, why: string | null): void => {
    refused = true;
    reason = why;
    setStatus(next);
  };

  const open = (): void => {
    if (left) {
      return;
    }
    if (!roomIsMade(doc)) {
      if (options.seed) {
        writeSeed(doc, options.seed, local);
      } else {
        makeEmptyRoom(doc, local);
      }
    }
    const bound = bindRoomDocument(doc, options.scene ?? editorScene, local);
    document = bound.document;
    unbindDocument = bound.unbind;
    roomDocuments.add(document);
  };

  roomToken(link).then(
    (token) => {
      if (left) {
        return;
      }
      connection = transport({
        roomId: link.roomId,
        token,
        doc,
        awareness,
        events: {
          synced: () => {
            if (!made) {
              made = true;
              open();
            }
            if (!left && !refused) {
              setStatus("joined");
            }
          },
          closed: (code, why) => {
            const next = refusal(code);
            if (next) {
              refuse(next, sizeRefusal(code, why));
            } else if (!refused) {
              setStatus("offline");
            }
          },
        },
      });
    },
    () => {
      if (!left) {
        refuse(
          "unavailable",
          "Shared maps need a secure page: open this map over https.",
        );
      }
    },
  );

  return {
    link,
    doc,
    get document() {
      return document;
    },
    get reason() {
      return reason;
    },
    presence,
    status(listener) {
      listeners.add(listener);
      listener(status);
      return () => {
        listeners.delete(listener);
      };
    },
    attach(editor) {
      if (!document) {
        throw new Error("attach() before the room joined");
      }
      return bindScene(doc, editor, local);
    },
    leave() {
      if (left) {
        return;
      }
      left = true;
      listeners.clear();
      unbindDocument?.();
      connection?.close();
      awareness.destroy();
      doc.destroy();
    },
  };
}
