// /maps routes. Bodies are raw octet-stream (parsed at server init); the
// 50 MiB bodyLimit answers 413 before a handler runs.
//
//   POST /maps            create; answers the map and its write key, once
//   PUT  /maps/:id        replace the bytes            (write key)
//   GET  /maps/:id/blob   the owner's backup           (write key)
//   DELETE /maps/:id      the map, its links and bytes (write key)
//
// There is no route that returns a map's record: nothing needs one.

import { ID_RE } from "../constants";

import { REFUSAL, writeKeyOrRefuse } from "./write-key";

import type { FastifyInstance } from "fastify";
import type { MapService } from "../service/maps";

interface IdParams {
  id: string;
}

const NOT_OCTETS = { error: "Content-Type must be application/octet-stream" };

export function registerMapRoutes(
  fastify: FastifyInstance,
  service: MapService,
): void {
  fastify.post("/maps", async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(415).send(NOT_OCTETS);
    }
    const result = await service.create(request.body);
    if (result.kind === "full") {
      return reply.code(REFUSAL.full.status).send(REFUSAL.full.body);
    }
    return reply
      .code(201)
      .header("Cache-Control", "no-store")
      .send({ ...result.map, write_key: result.writeKey });
  });

  fastify.put<{ Params: IdParams }>("/maps/:id", async (request, reply) => {
    const { id } = request.params;
    if (!ID_RE.test(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const writeKey = writeKeyOrRefuse(request, reply);
    if (writeKey === null) {
      return reply;
    }
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(415).send(NOT_OCTETS);
    }
    const result = await service.write(id, writeKey, request.body);
    if (result.kind !== "saved") {
      const refusal = REFUSAL[result.kind];
      return reply.code(refusal.status).send(refusal.body);
    }
    return reply.code(200).send(result.map);
  });

  fastify.delete<{ Params: IdParams }>("/maps/:id", async (request, reply) => {
    const { id } = request.params;
    if (!ID_RE.test(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const writeKey = writeKeyOrRefuse(request, reply);
    if (writeKey === null) {
      return reply;
    }
    const result = await service.remove(id, writeKey);
    if (result.kind !== "deleted") {
      const refusal = REFUSAL[result.kind];
      return reply.code(refusal.status).send(refusal.body);
    }
    return reply.code(204).send();
  });

  fastify.get<{ Params: IdParams }>(
    "/maps/:id/blob",
    async (request, reply) => {
      const { id } = request.params;
      if (!ID_RE.test(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const writeKey = writeKeyOrRefuse(request, reply);
      if (writeKey === null) {
        return reply;
      }
      const result = await service.read(id, writeKey);
      if (result.kind !== "bytes") {
        const refusal = REFUSAL[result.kind];
        return reply.code(refusal.status).send(refusal.body);
      }
      return reply
        .code(200)
        .header("Content-Type", "application/octet-stream")
        .header("Cache-Control", "no-store")
        .send(result.bytes);
    },
  );
}
