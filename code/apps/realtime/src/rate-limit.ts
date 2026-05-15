// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — per-socket rate limiter + message-size cap.
//
// Phase 5 Task 5 + Task 13 (atlasdraw plan 2026-05-03 § Task 5 + Task 13).
// Implements per-socket sliding-window counters for each event type. Windows
// reset every 100 ms (200 ms for COMMENT). Out-of-rate messages are silently
// dropped and logged at WARN level.
//
// Phase 5 Task 13 adds a discriminanted-union return type
// (CheckRateLimitResult) so callers can distinguish oversized from
// rate-limited results. The handler (socket-io-server.ts) disconnects sockets
// that exceed per-type byte caps with code 4008 MESSAGE_TOO_LARGE.
//
// ADR-0010: relay never inspects encrypted payloads — this limiter checks
// byte length only (Buffer.byteLength of the serialized JSON), never the
// content.

import type { Socket } from "socket.io";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event types subject to rate limiting. */
export type RateLimitedEvent =
  | "CURSOR"
  | "MAP_CAMERA_UPDATE"
  | "SCENE_UPDATE"
  | "COMMENT";

/**
 * Result of a rate-limit or size check.
 *
 * - `{ pass: true }` – the message is allowed.
 * - `{ pass: false, reason: "oversized", size, maxSize }` – payload exceeds the
 *   per-type byte cap. Handlers MUST disconnect the offending socket.
 * - `{ pass: false, reason: "rate_limited" }` – within rate but over the
 *   per-window count. Handlers MUST silently drop the message.
 */
export type CheckRateLimitResult =
  | { pass: true }
  | {
      pass: false;
      reason: "oversized";
      size: number;
      maxSize: number;
    }
  | { pass: false; reason: "rate_limited" };

interface RateLimitConfig {
  /** Max messages allowed per `windowMs`-long window. */
  maxPerWindow: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Max serialised payload size in bytes. */
  maxPayloadBytes: number;
}

interface RateLimitEntry {
  windowStart: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RATE_LIMITS: Record<RateLimitedEvent, RateLimitConfig> = {
  CURSOR: { maxPerWindow: 6, windowMs: 100, maxPayloadBytes: 1024 },
  MAP_CAMERA_UPDATE: { maxPerWindow: 3, windowMs: 100, maxPayloadBytes: 1024 },
  SCENE_UPDATE: { maxPerWindow: 1, windowMs: 100, maxPayloadBytes: 262144 },
  COMMENT: { maxPerWindow: 1, windowMs: 200, maxPayloadBytes: 65536 },
};

// ---------------------------------------------------------------------------
// Per-socket state (WeakMap — auto-GC when socket is disposed)
// ---------------------------------------------------------------------------

const rateLimitMap = new WeakMap<Socket, Map<RateLimitedEvent, RateLimitEntry>>();

function getEntry(socket: Socket, eventType: RateLimitedEvent): RateLimitEntry {
  let eventMap = rateLimitMap.get(socket);
  if (!eventMap) {
    eventMap = new Map();
    rateLimitMap.set(socket, eventMap);
  }
  let entry = eventMap.get(eventType);
  if (!entry) {
    entry = { windowStart: Date.now(), count: 0 };
    eventMap.set(eventType, entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a message from `socket` for `eventType` should be accepted.
 *
 * Checks payload serialised size first, then the per-window rate counter.
 * Returns `true` when the message passes both checks; `false` when it should
 * be silently dropped. Out-of-rate / oversized events are logged at WARN
 * with the socket id and event type.
 */
export function checkRateLimit(
  socket: Socket,
  eventType: RateLimitedEvent,
  payload: unknown,
): CheckRateLimitResult {
  const config = RATE_LIMITS[eventType];
  if (!config) return { pass: true }; // unknown event type — allow (safety net)

  // --- Payload size check ---
  const payloadSize = Buffer.byteLength(JSON.stringify(payload));
  if (payloadSize > config.maxPayloadBytes) {
    console.warn(
      `[realtime] WARN socket=${socket.id} event=${eventType} oversized ` +
        `(${payloadSize} B, max ${config.maxPayloadBytes} B)`,
    );
    return {
      pass: false,
      reason: "oversized",
      size: payloadSize,
      maxSize: config.maxPayloadBytes,
    };
  }

  // --- Rate window check ---
  const entry = getEntry(socket, eventType);
  const now = Date.now();

  if (now - entry.windowStart >= config.windowMs) {
    // Window expired — reset
    entry.windowStart = now;
    entry.count = 0;
  }

  entry.count += 1;
  if (entry.count > config.maxPerWindow) {
    console.warn(
      `[realtime] WARN socket=${socket.id} event=${eventType} rate-limited ` +
        `(${entry.count - 1}/${config.maxPerWindow} per ${config.windowMs} ms)`,
    );
    return { pass: false, reason: "rate_limited" };
  }

  return { pass: true };
}
