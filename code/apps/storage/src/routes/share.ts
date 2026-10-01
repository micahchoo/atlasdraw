// Share routes.
//
//   POST   /maps/:id/share          mint a read token        (write key)
//   DELETE /maps/:id/share/:token   revoke it                (write key)
//   GET    /share/:token/blob       the map's latest bytes   (token)
//
// A token reads the map's LATEST bytes, so a write to the map updates every
// link and embed made from it. By default a token lives until it is revoked;
// the body `{"expires_in_days": n}` gives it an expiry instead. Nothing a
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

/** The asked expiry: a whole number of days, null for none, or invalid. */
function expiryOf(body: unknown): number | null | "invalid" {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body !== "object" || Array.isArray(body) || isBlobBody(body)) {
    return "invalid";
  }
  const days = (body as { expires_in_days?: unknown }).expires_in_days;
  if (days === undefined || days === null) {
    return null;
  }
  return typeof days === "number" &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= MAX_EXPIRY_DAYS
    ? days
    : "invalid";
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
      const days = expiryOf(request.body);
      if (days === "invalid") {
        return reply.code(400).send({
          error: `expires_in_days must be a whole number from 1 to ${MAX_EXPIRY_DAYS}`,
        });
      }
      const result = await service.share(id, writeKey, days);
      if (result.kind !== "shared") {
        const refusal = REFUSAL[result.kind];
        return reply.code(refusal.status).send(refusal.body);
      }
      return reply.code(201).send({
        token: result.token,
        url: `${publicUrl}/m/${result.token}`,
        expires_at: result.expiresAt,
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
      // no-cache: the bytes change on every save and a revoke ends the link,
      // so a cache must ask again each time.
      return sendBlob(reply, result.blob, "no-cache");
    },
  );
}
