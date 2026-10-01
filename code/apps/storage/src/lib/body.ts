// A request body passes through the server as a stream; it is never held
// whole in memory. Its length is known before the first byte (the route
// requires Content-Length), so the store can check the size cap first and
// then check that exactly that many bytes arrived.

import { Transform } from "node:stream";

import type { TransformCallback } from "node:stream";

/** A body that does not have the length it announced. The client's fault. */
export class BodySizeError extends Error {
  readonly statusCode = 400;
  constructor(expected: number, got: string) {
    super(`body length is ${got}, not the ${expected} bytes announced`);
    this.name = "BodySizeError";
  }
}

/**
 * Passes bytes through unchanged, and fails the stream when more or fewer
 * than `size` bytes go through it.
 */
export function measured(size: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      seen += chunk.byteLength;
      if (seen > size) {
        done(new BodySizeError(size, `more than ${size}`));
        return;
      }
      done(null, chunk);
    },
    flush(done: TransformCallback) {
      done(seen === size ? null : new BodySizeError(size, String(seen)));
    },
  });
}
