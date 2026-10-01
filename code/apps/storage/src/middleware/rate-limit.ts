// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — per-address fixed-window rate limiter.
//
// A coarse limit on requests per client address per window, with no external
// dependency. `/health` is exempt, so a liveness probe never gets 429.
//
// The address is `request.ip`. Fastify reads it from X-Forwarded-For only
// when TRUST_PROXY names the proxy in front (config.ts); with no proxy it is
// the socket's address, so a client cannot choose it. An IPv6 client is
// counted by its /64 (client-key.ts).
//
// The counts live in this process. Several storage servers behind one proxy
// each count on their own; a shared limit belongs in the proxy.

import { clientKey } from "./client-key";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface RateLimitOptions {
  /** Max requests per window per address. 0 disables the limiter entirely. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

interface WindowEntry {
  windowStart: number;
  count: number;
}

/**
 * Counts events per key in fixed windows. `take` counts one and says whether
 * the key is still within `max`. Old windows are dropped on a timer, so the
 * map stays bounded under many keys; the timer does not hold the process.
 */
export class FixedWindow {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.timer = setInterval(() => this.prune(), windowMs);
    this.timer.unref();
  }

  /** Count one event for `key`. False when it passes `max` in this window. */
  take(key: string): boolean {
    const now = this.now();
    let entry = this.windows.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      entry = { windowStart: now, count: 0 };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  /** Whole seconds until `key`'s window ends, at least 1. */
  retryAfter(key: string): number {
    const entry = this.windows.get(key);
    const end = entry ? entry.windowStart + this.windowMs : this.now();
    return Math.max(1, Math.ceil((end - this.now()) / 1000));
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [key, entry] of this.windows) {
      if (entry.windowStart < cutoff) {
        this.windows.delete(key);
      }
    }
  }
}

/** The path without its query string. */
export function pathOf(request: FastifyRequest): string {
  return request.url.split("?")[0] ?? "";
}

/**
 * Register the per-address rate limit. When `max` is 0 the hook is not
 * installed at all.
 */
export function registerRateLimitMiddleware(
  fastify: FastifyInstance,
  opts: RateLimitOptions,
): void {
  if (opts.max <= 0) {
    return;
  }
  const limit = new FixedWindow(opts.max, opts.windowMs);
  fastify.addHook("onClose", async () => limit.stop());

  fastify.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (pathOf(request) === "/health") {
        return;
      }
      const key = clientKey(request.ip);
      if (limit.take(key)) {
        return;
      }
      reply.header("Retry-After", String(limit.retryAfter(key)));
      request.log.warn(
        { client: key, max: opts.max, windowMs: opts.windowMs },
        "rate_limited",
      );
      return reply.code(429).send({ error: "rate_limited" });
    },
  );
}
