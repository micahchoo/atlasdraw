// Reads a map's write key from `Authorization: Bearer <key>`.

import type { FastifyReply, FastifyRequest } from "fastify";

const BEARER = /^Bearer ([A-Za-z0-9_-]{1,256})$/;

/**
 * The write key the request carries, or null after it has answered 401.
 * The caller returns at once on null.
 */
export function writeKeyOrRefuse(
  request: FastifyRequest,
  reply: FastifyReply,
): string | null {
  const match = BEARER.exec(request.headers.authorization ?? "");
  if (!match) {
    void reply
      .code(401)
      .header("WWW-Authenticate", "Bearer")
      .send({ error: "write key required" });
    return null;
  }
  return match[1]!;
}

/** The status and body for a refusal from the map service. */
export const REFUSAL = {
  forbidden: { status: 403, body: { error: "write key does not match" } },
  missing: { status: 404, body: { error: "not found" } },
  full: { status: 507, body: { error: "storage is full" } },
} as const;
