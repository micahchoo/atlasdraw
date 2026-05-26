// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — Socket.IO event handlers for the relay.
//
// Phase 5 Task 5 + Task 13 (atlasdraw plan 2026-05-03 § Task 5 + Task 13).
// Registers the four Socket.IO event types that make the relay work:
//   - SCENE_UPDATE         – relay encrypted payload, LWW per-element (client)
//   - MAP_CAMERA_UPDATE    – relay plaintext camera, LWW by timestamp at relay
//   - CURSOR               – relay immediately, no LWW
//   - COMMENT              – relay encrypted payload, LWW by version at relay
//
// Task 13 additions:
//   - Room size guard: JOIN_ROOM checks io.sockets.adapter.rooms for the
//     target room and rejects the join with ROOM_FULL if already at
//     MAX_ROOM_SIZE (default 4, env-overridable).
//   - Oversized payload disconnection: the checkRateLimited wrapper detects
//     oversized results from rate-limit.ts and emits ERROR (code 4008
//     MESSAGE_TOO_LARGE) before calling socket.disconnect(true).
//
// Per ADR-0010 the relay never inspects encrypted payloads — SCENE_UPDATE
// and COMMENT data are forwarded as opaque { iv, ciphertext } blobs.

import { checkRateLimit } from "./rate-limit";

import type { Server as SocketIOServer, Socket } from "socket.io";
import type {
  SceneUpdateEvent,
  MapCameraUpdateEvent,
  CursorEvent,
  CommentEvent,
  RequestSnapshotEvent,
  SceneSnapshotEvent,
} from "@atlasdraw/protocol";
import type { RateLimitedEvent } from "./rate-limit";

// ---------------------------------------------------------------------------
// LWW dedup state – per-room per-sender
// ---------------------------------------------------------------------------

interface LWWState {
  /** Highest-seen MAP_CAMERA_UPDATE timestamp for this sender. */
  lastCameraTimestamp: number;
  /** Highest-seen COMMENT version for this sender. */
  lastCommentVersion: number;
}

/** roomId → senderId → LWWState */
const lwwByRoom = new Map<string, Map<string, LWWState>>();

function getLWWState(roomId: string, senderId: string): LWWState {
  let senderMap = lwwByRoom.get(roomId);
  if (!senderMap) {
    senderMap = new Map();
    lwwByRoom.set(roomId, senderMap);
  }
  let state = senderMap.get(senderId);
  if (!state) {
    state = { lastCameraTimestamp: 0, lastCommentVersion: 0 };
    senderMap.set(senderId, state);
  }
  return state;
}

function removeSenderFromRoom(roomId: string, senderId: string): void {
  const senderMap = lwwByRoom.get(roomId);
  if (senderMap) {
    senderMap.delete(senderId);
    if (senderMap.size === 0) {
      lwwByRoom.delete(roomId);
    }
  }
}

// ---------------------------------------------------------------------------
// Socket sender-id tracking (for cleanup on disconnect)
// ---------------------------------------------------------------------------

const socketSenderIds = new WeakMap<Socket, Set<string>>();

function trackSender(socket: Socket, senderId: string): void {
  let ids = socketSenderIds.get(socket);
  if (!ids) {
    ids = new Set();
    socketSenderIds.set(socket, ids);
  }
  ids.add(senderId);
}

// ---------------------------------------------------------------------------
// Handler implementation
// ---------------------------------------------------------------------------

/**
 * Register all Socket.IO event handlers on the provided `io` server.
 *
 * Each socket that connects receives per-event handlers that:
 *   - Enforce rate limits (via checkRateLimit in rate-limit.ts)
 *   - Validate payload shape for encrypted events
 *   - Apply LWW dedup for MAP_CAMERA_UPDATE (by timestamp) and COMMENT (by version)
 *   - Relay to all room members except the sender
 *   - Never inspect encrypted payload content
 */
export function registerSocketIOHandlers(io: SocketIOServer): void {
  // Maximum concurrent sockets per room — env-configurable, default 4.
  const MAX_ROOM_SIZE = parseInt(process.env.MAX_ROOM_SIZE ?? "4", 10);

  io.on("connection", (socket: Socket) => {
    // -----------------------------------------------------------------------
    // Per-socket state
    // -----------------------------------------------------------------------
    let currentRoom: string | null = null;

    // -----------------------------------------------------------------------
    // JOIN_ROOM — with room-size guard (MAX_ROOM_SIZE, default 4)
    //
    // Phase 6 A9: payload accepts an optional `workspaceId: string`. When
    // present, the actual Socket.IO room key becomes `${workspaceId}/${roomId}`
    // so cross-workspace leakage is impossible at the relay layer. Self-host
    // clients (Phase 5 collab) omit the field and the legacy single-tenant
    // room key is preserved — existing tests must keep passing.
    //
    // The relay is opaque — it never reads the joined room key out of any
    // subsequent event. SCENE_UPDATE / CURSOR / COMMENT carry the same
    // `roomId` the client used here (which means workspace-namespaced if
    // the client passed workspaceId at join time), so room alignment is
    // the client's contract to maintain.
    // -----------------------------------------------------------------------
    socket.on("JOIN_ROOM", (payload: unknown) => {
      if (
        !payload ||
        typeof payload !== "object" ||
        typeof (payload as Record<string, unknown>).roomId !== "string"
      ) {
        return;
      }
      const obj = payload as Record<string, unknown>;
      const baseRoomId = obj.roomId as string;
      if (!baseRoomId) {
        return;
      }

      // Phase 6 A9: optional workspaceId namespace.
      const rawWorkspace = obj.workspaceId;
      const workspaceId =
        typeof rawWorkspace === "string" && rawWorkspace.length > 0
          ? rawWorkspace
          : null;
      const roomKey = workspaceId ? `${workspaceId}/${baseRoomId}` : baseRoomId;

      // Room size guard — reject join if room already has MAX_ROOM_SIZE sockets
      const roomSockets = io.sockets.adapter.rooms.get(roomKey);
      if (roomSockets && roomSockets.size >= MAX_ROOM_SIZE) {
        socket.emit("ROOM_FULL", {
          code: "ROOM_FULL",
          message: "Room is full",
          roomId: baseRoomId,
        });
        return;
      }

      currentRoom = roomKey;
      socket.join(roomKey);

      // Notify existing peers that a new participant joined.
      socket.to(roomKey).emit("PEER_JOINED", { peerId: socket.id });
    });

    // -----------------------------------------------------------------------
    // SCENE_UPDATE – validate encrypted fields, relay blindly
    // -----------------------------------------------------------------------
    socket.on("SCENE_UPDATE", (payload: unknown) => {
      if (!checkRateLimited(socket, "SCENE_UPDATE", payload)) {
        return;
      }

      const evt = payload as Partial<SceneUpdateEvent>;
      if (
        !evt.data ||
        typeof evt.data.iv !== "string" ||
        typeof evt.data.ciphertext !== "string"
      ) {
        return; // malformed — silently drop
      }

      trackSender(socket, evt.senderId ?? "");
      socket.to(evt.roomId ?? "").emit("SCENE_UPDATE", payload);
    });

    // -----------------------------------------------------------------------
    // MAP_CAMERA_UPDATE – LWW by timestamp
    // -----------------------------------------------------------------------
    socket.on("MAP_CAMERA_UPDATE", (payload: unknown) => {
      if (!checkRateLimited(socket, "MAP_CAMERA_UPDATE", payload)) {
        return;
      }

      const evt = payload as Partial<MapCameraUpdateEvent>;
      const roomId = evt.roomId ?? "";
      const senderId = evt.senderId ?? "";
      if (!roomId || !senderId) {
        return;
      }

      const state = getLWWState(roomId, senderId);
      if ((evt.timestamp ?? 0) > state.lastCameraTimestamp) {
        state.lastCameraTimestamp = evt.timestamp ?? 0;
        trackSender(socket, senderId);
        socket.to(roomId).emit("MAP_CAMERA_UPDATE", payload);
      }
    });

    // -----------------------------------------------------------------------
    // CURSOR – relay immediately, no LWW
    // -----------------------------------------------------------------------
    socket.on("CURSOR", (payload: unknown) => {
      if (!checkRateLimited(socket, "CURSOR", payload)) {
        return;
      }

      const evt = payload as Partial<CursorEvent>;
      const roomId = evt.roomId ?? "";
      const senderId = evt.senderId ?? "";
      if (!roomId || !senderId) {
        return;
      }

      trackSender(socket, senderId);
      socket.to(roomId).emit("CURSOR", payload);
    });

    // -----------------------------------------------------------------------
    // COMMENT – LWW by version field
    // -----------------------------------------------------------------------
    socket.on("COMMENT", (payload: unknown) => {
      if (!checkRateLimited(socket, "COMMENT", payload)) {
        return;
      }

      const evt = payload as Partial<CommentEvent>;
      const roomId = evt.roomId ?? "";
      const senderId = evt.senderId ?? "";
      if (!roomId || !senderId || !evt.data) {
        return;
      }

      const state = getLWWState(roomId, senderId);
      if ((evt.data.version ?? 0) > state.lastCommentVersion) {
        state.lastCommentVersion = evt.data.version ?? 0;
        trackSender(socket, senderId);
        socket.to(roomId).emit("COMMENT", payload);
      }
    });

    // -----------------------------------------------------------------------
    // REQUEST_SNAPSHOT — joiner-pull (Q-P5-1)
    //
    // The joiner emits this once after JOIN_ROOM is acked. The relay
    // deterministically elects ONE existing room member (lexicographically
    // smallest socket.id) and forwards the request to that peer only. Never
    // broadcast. If the requester is alone in the room, do nothing — the
    // joiner stays with an empty scene (correct outcome for an empty room).
    //
    // The relay reads the requester's own socket.id server-side and stamps
    // it as senderId in the routed envelope, so the elected peer knows
    // whom to address its SCENE_SNAPSHOT reply to.
    // -----------------------------------------------------------------------
    socket.on("REQUEST_SNAPSHOT", (payload: unknown) => {
      if (
        !payload ||
        typeof payload !== "object" ||
        typeof (payload as Record<string, unknown>).roomId !== "string"
      ) {
        return; // malformed — silently drop
      }
      const { roomId } = payload as { roomId: string };
      if (!roomId || roomId !== currentRoom) {
        return;
      }

      const roomSockets = io.sockets.adapter.rooms.get(roomId);
      if (!roomSockets) {
        return;
      }

      // Election: lexicographically-smallest socket.id excluding requester.
      // Deterministic & churn-resilient — same id wins across re-requests
      // unless the prior winner disconnected.
      let elected: string | null = null;
      for (const id of roomSockets) {
        if (id === socket.id) {
          continue;
        }
        if (elected === null || id < elected) {
          elected = id;
        }
      }
      if (elected === null) {
        return;
      } // requester is alone — no-op

      const envelope: RequestSnapshotEvent = {
        type: "REQUEST_SNAPSHOT",
        roomId,
        senderId: socket.id,
        timestamp: Date.now(),
      };
      io.to(elected).emit("REQUEST_SNAPSHOT", envelope);
    });

    // -----------------------------------------------------------------------
    // SCENE_SNAPSHOT — encrypted reply to a joiner-pull (Q-P5-1)
    //
    // Emitted by the peer that the relay elected. Routed to `targetId` only,
    // never broadcast. Validates payload shape (iv + ciphertext, both
    // strings), confirms target is in the same room (no cross-room leakage),
    // applies the same byte cap as SCENE_UPDATE (256 KB).
    // -----------------------------------------------------------------------
    socket.on("SCENE_SNAPSHOT", (payload: unknown) => {
      if (!checkRateLimited(socket, "SCENE_SNAPSHOT", payload)) {
        return;
      }

      const evt = payload as Partial<SceneSnapshotEvent>;
      if (
        typeof evt.roomId !== "string" ||
        typeof evt.targetId !== "string" ||
        !evt.data ||
        typeof evt.data.iv !== "string" ||
        typeof evt.data.ciphertext !== "string"
      ) {
        return; // malformed — silently drop
      }

      // Sender must be in the room they claim, and target must be in the
      // same room — prevents cross-room snapshot leakage.
      if (evt.roomId !== currentRoom) {
        return;
      }
      const targetSocket = io.sockets.sockets.get(evt.targetId);
      if (!targetSocket || !targetSocket.rooms.has(evt.roomId)) {
        return;
      }

      const envelope: SceneSnapshotEvent = {
        type: "SCENE_SNAPSHOT",
        roomId: evt.roomId,
        senderId: socket.id,
        timestamp: Date.now(),
        targetId: evt.targetId,
        data: evt.data,
      };
      io.to(evt.targetId).emit("SCENE_SNAPSHOT", envelope);
    });

    // -----------------------------------------------------------------------
    // LEAVE_ROOM
    // -----------------------------------------------------------------------
    socket.on("LEAVE_ROOM", () => {
      if (currentRoom) {
        socket.to(currentRoom).emit("PEER_LEFT", { peerId: socket.id });
        cleanupSenderIds(socket, currentRoom);
        socket.leave(currentRoom);
        currentRoom = null;
      }
    });

    // -----------------------------------------------------------------------
    // disconnect
    // -----------------------------------------------------------------------
    socket.on("disconnect", () => {
      if (currentRoom) {
        socket.to(currentRoom).emit("PEER_LEFT", { peerId: socket.id });
        cleanupSenderIds(socket, currentRoom);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Helper: clean up LWW state for a socket's tracked sender IDs
  // -------------------------------------------------------------------------
  function cleanupSenderIds(socket: Socket, roomId: string): void {
    const ids = socketSenderIds.get(socket);
    if (ids) {
      for (const senderId of ids) {
        removeSenderFromRoom(roomId, senderId);
      }
      socketSenderIds.delete(socket);
    }
  }
}

// ---------------------------------------------------------------------------
// Rate-limit wrapper — keeps handler bodies clean
// ---------------------------------------------------------------------------

function checkRateLimited(
  socket: Socket,
  eventType: RateLimitedEvent,
  payload: unknown,
): boolean {
  const result = checkRateLimit(socket, eventType, payload);
  if (!result.pass && result.reason === "oversized") {
    // Emit an ERROR event then disconnect on next tick — this gives
    // Socket.IO's async flush time to deliver the packet before the
    // transport closes.
    socket.emit("ERROR", { code: 4008, message: "MESSAGE_TOO_LARGE" });
    setImmediate(() => {
      socket.disconnect(true);
    });
  }
  return result.pass;
}
