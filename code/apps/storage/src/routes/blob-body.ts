// How a map's bytes cross HTTP, in both directions.
//
// In: an `application/octet-stream` body is not read by the parser. The
// route gets a `BlobBody` (the request stream and its Content-Length) and the
// store streams it to disk or S3. The length must be announced (411 if not)
// and within MAX_MAP_BYTES (413), so a refusal costs no bytes.
//
// Out: a blob is sent as a stream with its length. It is a download that no
// browser may render or run: anyone can store any bytes, and a share link
// serves them from the operator's domain.

import type { FastifyInstance, FastifyReply } from "fastify";
import type { BlobBody, BlobRead } from "../types";

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function registerBlobBodyParser(
  app: FastifyInstance,
  maxBytes: number,
): void {
  app.addContentTypeParser(
    "application/octet-stream",
    (request, payload, done) => {
      const raw = request.headers["content-length"];
      if (raw === undefined || !/^\d+$/.test(raw)) {
        done(httpError(411, "Content-Length required"), undefined);
        return;
      }
      const size = Number(raw);
      if (size > maxBytes) {
        done(httpError(413, "Request body is too large"), undefined);
        return;
      }
      const body: BlobBody = { stream: payload, size };
      done(null, body);
    },
  );
}

export function isBlobBody(body: unknown): body is BlobBody {
  const b = body as BlobBody | undefined;
  return (
    typeof b === "object" &&
    b !== null &&
    typeof b.size === "number" &&
    typeof (b.stream as { pipe?: unknown } | undefined)?.pipe === "function"
  );
}

/** Sends a map's bytes as an inert download. */
export function sendBlob(
  reply: FastifyReply,
  blob: BlobRead,
  cacheControl: string,
): FastifyReply {
  return reply
    .code(200)
    .header("Content-Type", "application/octet-stream")
    .header("Content-Length", String(blob.size))
    .header("Content-Disposition", 'attachment; filename="map.atlasdraw"')
    .header("X-Content-Type-Options", "nosniff")
    .header("Content-Security-Policy", "sandbox; default-src 'none'")
    .header("Cache-Control", cacheControl)
    .send(blob.stream);
}
