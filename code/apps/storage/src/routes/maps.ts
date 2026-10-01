// @atlasdraw/storage — Phase 4 T3: /maps routes.
//
// Three endpoints — POST (create), GET (read), PUT (update). Body is raw
// octet-stream (octets parsed at server init via addContentTypeParser). The
// 50 MiB body limit is enforced by Fastify's bodyLimit option; oversize
// uploads return 413 before the handler runs.

import { ID_RE } from "../constants";
import { isNotFoundError } from "../lib/errors";

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MapRecord, StorageClient } from "../types";

/** A map record as clients see it: `blob_ref` is a server-side location. */
function publicRecord({ blob_ref: _, ...rest }: MapRecord) {
  return rest;
}

interface IdParams {
  id: string;
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
    const record = await client.createMap(body);
    return reply.code(201).send(publicRecord(record));
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
      return reply.code(200).send(publicRecord(record));
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
        return reply.code(200).send(publicRecord(record));
      } catch (err) {
        if (isNotFoundError(err)) {
          return reply.code(404).send({ error: "not found" });
        }
        throw err;
      }
    },
  );
}
