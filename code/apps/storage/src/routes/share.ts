// Share routes.
//
//   POST   /maps/:id/share          mint a read token        (write key)
//   DELETE /maps/:id/share/:token   revoke it                (write key)
//   GET    /share/:token/blob       the map's bytes          (token)
//
// A token reads the map's LATEST bytes, so a write to the map updates every
// link and embed made from it. By default a token lives until it is revoked;
// the body `{"expires_in_days": n}` gives it an expiry instead. The body
// `{"revision": n}` freezes the token on that revision: later writes do not
// change what it reads, and the store keeps that version while the token
// lives (docs/architecture/adr/0020-server-version-history.md). Nothing a
// token holder can fetch carries the map id or the write key.

import { ID_RE } from "../constants";

import { isBlobBody, sendBlob } from "./blob-body";
import { REFUSAL, writeKeyOrRefuse } from "./write-key";

import type { FastifyInstance } from "fastify";
import type { MapService } from "../service/maps";

interface IdParams {
  id: string;
}

interface TokenParams {
  token: string;
}

/** Ten years: longer than that, choose no expiry. */
const MAX_EXPIRY_DAYS = 3650;

interface ShareRequest {
  /** Whole days, or null for none. */
  days: number | null;
  /** The revision to freeze on, or null for the latest bytes. */
  revision: number | null;
}

/** A whole number from `min` to `max`, null when absent, or invalid. */
function wholeOf(
  value: unknown,
  min: number,
  max: number,
): number | null | "invalid" {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : "invalid";
}

/** The asked expiry and revision, or "invalid". */
function shareRequestOf(body: unknown): ShareRequest | "invalid" {
  if (body === undefined || body === null) {
    return { days: null, revision: null };
  }
  if (typeof body !== "object" || Array.isArray(body) || isBlobBody(body)) {
    return "invalid";
  }
  const asked = body as { expires_in_days?: unknown; revision?: unknown };
  const days = wholeOf(asked.expires_in_days, 1, MAX_EXPIRY_DAYS);
  const revision = wholeOf(asked.revision, 1, Number.MAX_SAFE_INTEGER);
  return days === "invalid" || revision === "invalid"
    ? "invalid"
    : { days, revision };
}

export function registerShareRoutes(
  fastify: FastifyInstance,
  service: MapService,
  publicUrl: string,
): void {
  fastify.post<{ Params: IdParams }>(
    "/maps/:id/share",
    async (request, reply) => {
      const { id } = request.params;
      if (!ID_RE.test(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const writeKey = writeKeyOrRefuse(request, reply);
      if (writeKey === null) {
        return reply;
      }
      const asked = shareRequestOf(request.body);
      if (asked === "invalid") {
        return reply.code(400).send({
          error: `expires_in_days must be a whole number from 1 to ${MAX_EXPIRY_DAYS}, and revision a whole number from 1`,
        });
      }
      const result = await service.share(
        id,
        writeKey,
        asked.days,
        asked.revision,
      );
      if (result.kind !== "shared") {
        const refusal = REFUSAL[result.kind];
        return reply.code(refusal.status).send(refusal.body);
      }
      return reply.code(201).send({
        token: result.token,
        url: `${publicUrl}/m/${result.token}`,
        expires_at: result.expiresAt,
        revision: result.revision,
      });
    },
  );

  fastify.delete<{ Params: IdParams & TokenParams }>(
    "/maps/:id/share/:token",
    async (request, reply) => {
      const { id, token } = request.params;
      if (!ID_RE.test(id) || !ID_RE.test(token)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const writeKey = writeKeyOrRefuse(request, reply);
      if (writeKey === null) {
        return reply;
      }
      const result = await service.revoke(id, writeKey, token);
      if (result.kind !== "revoked") {
        const refusal = REFUSAL[result.kind];
        return reply.code(refusal.status).send(refusal.body);
      }
      return reply.code(204).send();
    },
  );

  fastify.get<{ Params: TokenParams }>(
    "/share/:token/blob",
    async (request, reply) => {
      const { token } = request.params;
      if (!ID_RE.test(token)) {
        return reply.code(400).send({ error: "invalid token" });
      }
      const result = await service.readShared(token);
      if (result.kind === "missing") {
        return reply.code(404).send({ error: "not found" });
      }
      if (result.kind === "expired") {
        return reply.code(410).send({ error: "expired" });
      }
      // no-cache: the bytes change on every save (unless the link is frozen)
      // and a revoke ends the link, so a cache must ask again each time.
      return sendBlob(reply, result.blob, "no-cache");
    },
  );
}
