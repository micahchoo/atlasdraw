// A map's server versions (docs/architecture/adr/0020-server-version-history.md).
//
//   GET /maps/:id/versions                  every revision kept   (write key)
//   GET /maps/:id/versions/:revision/blob   one revision's bytes  (write key)
//
// Only the write key opens them. A share token is a reader's capability:
// it reads the bytes its link shows, latest or frozen, and no others.
// Restoring is the client's: it reads a version, then saves it as a new
// revision with `PUT /maps/:id?checkpoint=1`. History is never rewritten.

import { ID_RE } from "../constants";

import { sendBlob } from "./blob-body";
import { etagOf } from "./maps";
import { REFUSAL, writeKeyOrRefuse } from "./write-key";

import type { FastifyInstance } from "fastify";
import type { MapService } from "../service/maps";

interface IdParams {
  id: string;
}

interface RevisionParams extends IdParams {
  revision: string;
}

const REVISION = /^[1-9][0-9]{0,15}$/;

export function registerVersionRoutes(
  fastify: FastifyInstance,
  service: MapService,
): void {
  fastify.get<{ Params: IdParams }>(
    "/maps/:id/versions",
    async (request, reply) => {
      const { id } = request.params;
      if (!ID_RE.test(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const writeKey = writeKeyOrRefuse(request, reply);
      if (writeKey === null) {
        return reply;
      }
      const result = await service.versions(id, writeKey);
      if (result.kind !== "versions") {
        const refusal = REFUSAL[result.kind];
        return reply.code(refusal.status).send(refusal.body);
      }
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send({ current: result.current, versions: result.versions });
    },
  );

  fastify.get<{ Params: RevisionParams }>(
    "/maps/:id/versions/:revision/blob",
    async (request, reply) => {
      const { id, revision } = request.params;
      if (!ID_RE.test(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      if (!REVISION.test(revision)) {
        return reply.code(400).send({ error: "invalid revision" });
      }
      const writeKey = writeKeyOrRefuse(request, reply);
      if (writeKey === null) {
        return reply;
      }
      const result = await service.readVersion(id, writeKey, Number(revision));
      if (result.kind !== "bytes") {
        const refusal = REFUSAL[result.kind];
        return reply.code(refusal.status).send(refusal.body);
      }
      return sendBlob(
        reply.header("ETag", etagOf(result.blob.revision)),
        result.blob,
        "no-store",
      );
    },
  );
}
