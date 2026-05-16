// @atlasdraw/storage — Phase 4 T4 + T8 amendment: /maps/:id/share +
// /share/:token + /share/:token/blob routes.
//
// Three endpoints:
//   POST /maps/:id/share      — mint a 7-day read token for an existing map.
//   GET  /share/:token        — resolve a token to its MapRecord, gated by
//                               expiry. `mode` is hard-coded "read" in the
//                               response (Phase 4 only mints read tokens;
//                               never echoed from request body/query).
//   GET  /share/:token/blob   — return the raw map blob bytes for a token.
//                               Same validation gates as the JSON route plus
//                               a defensive 410 if the blob is missing on
//                               storage (orphan-row variant).
//
// TTL is owned by the adapter (T3 hard-codes 7 days inside
// createShareToken). T4 only validates inputs, formats response URLs,
// and enforces expiry/orphaned-token semantics.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { StorageClient } from "../types";

// nanoid v3 default alphabet: A-Z a-z 0-9 _ -; default size 21. Both map
// ids and share tokens are minted via nanoid(21), so the same regex
// gates both. Inline-copy from routes/maps.ts on purpose — see T4 scrub
// note (do not refactor maps.ts in this task).
const ID_RE = /^[A-Za-z0-9_-]{21}$/;

interface IdParams {
  id: string;
}

interface TokenParams {
  token: string;
}

function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("not found:");
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
        // Phase 6 A9: token is scoped to the requesting workspace (or
        // null in self-host) and a `workspace_scoped` event emits per
        // ADR-0011 when the context is non-null.
        const workspaceId = request.workspace ?? null;
        const token = await client.createShareToken(id, { workspaceId });
        if (workspaceId) {
          request.log.info(
            { workspaceId, route: "/maps/:id/share", method: "POST" },
            "workspace_scoped",
          );
        }
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
    "/share/:token",
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
        // Orphaned token: map was deleted out from under it. Same wire
        // shape as expiry — caller can't act on it either way.
        return reply.code(410).send({ error: "expired" });
      }
      // `mode` is server-set, never echoed from request input. Phase 4
      // only has read tokens.
      return reply.code(200).send({ map, mode: "read" as const });
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
