// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — a per-address limit on requests in flight.
//
// The rate limiter counts requests per window; it does not see a request
// that stays open. A client that opens many blob reads and never reads the
// answers holds a socket, a file handle and a stream for each one. This
// limit counts the requests of one address that have not ended yet. Past
// `max`, a new one gets 429 at once. A slot is free again when its response
// ends or its connection closes. `/health` is exempt.

import { clientKey } from "./client-key";
import { pathOf } from "./rate-limit";

import type { FastifyInstance } from "fastify";

export function registerInFlightLimit(
  fastify: FastifyInstance,
  max: number,
): void {
  if (max <= 0) {
    return;
  }
  const open = new Map<string, number>();

  fastify.addHook("onRequest", async (request, reply) => {
    if (pathOf(request) === "/health") {
      return;
    }
    const key = clientKey(request.ip);
    const count = open.get(key) ?? 0;
    if (count >= max) {
      request.log.warn({ client: key, max }, "too_many_in_flight");
      return reply
        .code(429)
        .header("Retry-After", "1")
        .send({ error: "too many requests in flight" });
    }
    open.set(key, count + 1);
    // `close` fires once, when the response ends or the socket goes.
    reply.raw.once("close", () => {
      const left = (open.get(key) ?? 1) - 1;
      if (left > 0) {
        open.set(key, left);
      } else {
        open.delete(key);
      }
    });
  });
}
