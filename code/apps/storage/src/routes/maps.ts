// /maps routes. A body is raw octet-stream with a Content-Length, streamed
// to the store (blob-body.ts): 411 without the length, 413 past
// MAX_MAP_BYTES, both before a handler runs.
//
//   POST /maps            create; answers the map and its write key, once
//   PUT  /maps/:id        replace the bytes            (write key)
//   GET  /maps/:id/blob   the owner's backup           (write key)
//   DELETE /maps/:id      the map, its links and bytes (write key)
//
// There is no route that returns a map's record: nothing needs one.
//
// Every save counts one more revision, sent as `revision` and as the ETag
// `"<n>"`. A PUT with `If-Match: "<n>"` lands only on revision n; else 412
// with the map's revision, and nothing is stored. With no If-Match, or `*`,
// the PUT does not check (docs/architecture/adr/0020-server-version-history.md).

import { ID_RE } from "../constants";
import { clientKey } from "../middleware/client-key";
import { FixedWindow } from "../middleware/rate-limit";

import { isBlobBody, sendBlob } from "./blob-body";
import { REFUSAL, writeKeyOrRefuse } from "./write-key";

import type { FastifyInstance } from "fastify";
import type { MapService } from "../service/maps";

interface IdParams {
  id: string;
}

const NOT_OCTETS = { error: "Content-Type must be application/octet-stream" };

/** One revision as an entity tag: `"3"`. */
export const etagOf = (revision: number): string => `"${revision}"`;

const ONE_REVISION = /^"([1-9][0-9]{0,15})"$/;

/**
 * The revision an If-Match names: a number, undefined for none or `*`, or
 * "invalid". A list of tags and a weak tag are invalid: a write replaces one
 * exact revision.
 */
export function ifMatchOf(
  header: string | undefined,
): number | undefined | "invalid" {
  if (header === undefined || header.trim() === "*") {
    return undefined;
  }
  const match = ONE_REVISION.exec(header.trim());
  return match ? Number(match[1]) : "invalid";
}

export interface NewMapLimit {
  /** New maps per address per window. 0: no limit. */
  maxNewMaps: number;
  windowMs: number;
}

export function registerMapRoutes(
  fastify: FastifyInstance,
  service: MapService,
  limit: NewMapLimit = { maxNewMaps: 0, windowMs: 1 },
): void {
  // POST /maps hands anyone a key; this bounds how many per address.
  const newMaps =
    limit.maxNewMaps > 0
      ? new FixedWindow(limit.maxNewMaps, limit.windowMs)
      : null;
  if (newMaps) {
    fastify.addHook("onClose", async () => newMaps.stop());
  }

  fastify.post("/maps", async (request, reply) => {
    if (!isBlobBody(request.body)) {
      return reply.code(415).send(NOT_OCTETS);
    }
    const client = clientKey(request.ip);
    if (newMaps && !newMaps.take(client)) {
      return reply
        .code(429)
        .header("Retry-After", String(newMaps.retryAfter(client)))
        .send({ error: "too many new maps from this address" });
    }
    const result = await service.create(request.body);
    if (result.kind === "full") {
      return reply.code(REFUSAL.full.status).send(REFUSAL.full.body);
    }
    return reply
      .code(201)
      .header("Cache-Control", "no-store")
      .header("ETag", etagOf(result.map.revision))
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
    if (!isBlobBody(request.body)) {
      return reply.code(415).send(NOT_OCTETS);
    }
    const ifRevision = ifMatchOf(request.headers["if-match"]);
    if (ifRevision === "invalid") {
      return reply
        .code(400)
        .send({ error: 'If-Match must be one revision, as "<n>", or *' });
    }
    const result = await service.write(id, writeKey, request.body, {
      ifRevision,
    });
    if (result.kind === "conflict") {
      return reply.code(412).header("ETag", etagOf(result.revision)).send({
        error: "the map has changed since this revision",
        revision: result.revision,
      });
    }
    if (result.kind !== "saved") {
      const refusal = REFUSAL[result.kind];
      return reply.code(refusal.status).send(refusal.body);
    }
    return reply
      .code(200)
      .header("ETag", etagOf(result.map.revision))
      .send(result.map);
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
      return sendBlob(
        reply.header("ETag", etagOf(result.blob.revision)),
        result.blob,
        "no-store",
      );
    },
  );
}
