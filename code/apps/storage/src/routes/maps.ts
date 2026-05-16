// @atlasdraw/storage — Phase 4 T3: /maps routes.
//
// Three endpoints — POST (create), GET (read), PUT (update). Body is raw
// octet-stream (octets parsed at server init via addContentTypeParser). The
// 50 MiB body limit is enforced by Fastify's bodyLimit option; oversize
// uploads return 413 before the handler runs.
//
// Phase 6 A9: when the workspace middleware attaches `request.workspace`,
// `createMap` is scoped to that workspace and a `workspace_scoped` event
// emits via the request's pino logger per ADR-0011.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { StorageClient } from "../types";

const ID_RE = /^[A-Za-z0-9_-]{21}$/;

interface IdParams {
  id: string;
}

function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("not found:");
}

export function registerMapRoutes(
  fastify: FastifyInstance,
  client: StorageClient,
): void {
  fastify.post("/maps", async (request, reply) => {
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      return reply
        .code(415)
        .send({ error: "Content-Type must be application/octet-stream" });
    }
    const workspaceId = request.workspace ?? null;
    const record = await client.createMap(body, { workspaceId });
    if (workspaceId) {
      // ADR-0011: server-side workspace-scoped event. Emits only when a
      // workspace context is attached (managed mode or self-host where
      // the operator passed the header).
      request.log.info(
        { workspaceId, route: "/maps", method: "POST" },
        "workspace_scoped",
      );
    }
    return reply.code(201).send(record);
  });

  fastify.get<{ Params: IdParams }>(
    "/maps/:id",
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const { id } = request.params;
      if (!ID_RE.test(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const record = await client.getMap(id);
      if (!record) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.code(200).send(record);
    },
  );

  fastify.put<{ Params: IdParams }>(
    "/maps/:id",
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const { id } = request.params;
      if (!ID_RE.test(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        return reply
          .code(415)
          .send({ error: "Content-Type must be application/octet-stream" });
      }
      try {
        const record = await client.updateMap(id, body);
        return reply.code(200).send(record);
      } catch (err) {
        if (isNotFoundError(err)) {
          return reply.code(404).send({ error: "not found" });
        }
        throw err;
      }
    },
  );
}
