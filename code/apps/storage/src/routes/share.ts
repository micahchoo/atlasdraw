// @atlasdraw/storage — share routes.
//
//   POST /maps/:id/share      — mint a 7-day read token for an existing map.
//   GET  /share/:token/blob   — return the map bytes for a valid token.
//
// A token holder must never learn the map id: PUT /maps/:id needs nothing
// but the id, so the id is the write capability. That is why there is no
// route that resolves a token to its map record.
//
// TTL is owned by the adapter (createShareToken hard-codes 7 days).

import { ID_RE } from "../constants";
import { isNotFoundError } from "../lib/errors";

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { StorageClient } from "../types";

interface IdParams {
  id: string;
}

interface TokenParams {
  token: string;
}

export function registerShareRoutes(
  fastify: FastifyInstance,
  client: StorageClient,
  publicUrl: string,
): void {
  fastify.post<{ Params: IdParams }>(
    "/maps/:id/share",
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const { id } = request.params;
      if (!ID_RE.test(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      // Verify the map exists *before* minting a token. Adapters also
      // raise "not found:" from createShareToken if the row is missing,
      // but a pre-check produces a cleaner 404 with no orphaned-token
      // window if the adapter contract ever changes.
      const map = await client.getMap(id);
      if (!map) {
        return reply.code(404).send({ error: "not found" });
      }
      try {
        const token = await client.createShareToken(id);
        return reply.code(201).send({
          token: token.token,
          url: `${publicUrl}/m/${token.token}`,
          expires_at: token.expires_at,
        });
      } catch (err) {
        if (isNotFoundError(err)) {
          return reply.code(404).send({ error: "not found" });
        }
        throw err;
      }
    },
  );

  fastify.get<{ Params: TokenParams }>(
    "/share/:token/blob",
    async (request: FastifyRequest<{ Params: TokenParams }>, reply) => {
      const { token } = request.params;
      if (!ID_RE.test(token)) {
        return reply.code(400).send({ error: "invalid token" });
      }
      const shareToken = await client.resolveToken(token);
      if (!shareToken) {
        return reply.code(404).send({ error: "not found" });
      }
      if (new Date(shareToken.expires_at).getTime() <= Date.now()) {
        return reply.code(410).send({ error: "expired" });
      }
      const map = await client.getMap(shareToken.map_id);
      if (!map) {
        // Orphaned token — same wire shape as expiry.
        return reply.code(410).send({ error: "expired" });
      }
      const blob = await client.getBlob(shareToken.map_id);
      if (!blob) {
        // Map row exists but the underlying blob is gone — treat as
        // orphaned. Defensive: shouldn't happen under normal operation.
        return reply.code(410).send({ error: "expired" });
      }
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Cache-Control", "private, max-age=60");
      return reply.code(200).send(blob);
    },
  );
}
