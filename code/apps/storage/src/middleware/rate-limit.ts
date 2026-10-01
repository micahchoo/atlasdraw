// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — per-IP fixed-window rate limiter.
//
// The storage API is the internet-facing service (behind Caddy). The 50 MiB
// body cap bounds one request, not request counts; without this limiter
// POST /maps, share-token guessing and blob fill are unbounded
// (SECURITY.md row 7).
//
// Hand-rolled fixed-window counter keyed by client IP (no external
// dependency). Fastify's `trustProxy` follows TRUST_PROXY (config.ts), so
// behind Caddy `request.ip` is the client from X-Forwarded-For, not the
// proxy's own address. /health is exempt so liveness probes never 429.
//
// This is a coarse abuse blunt, not a fairness scheduler: one window, one cap,
// per IP. Multi-instance deployments that need shared limits should front the
// API with a proxy-level limiter (or Redis) — noted in the trust-boundary doc.

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export interface RateLimitOptions {
  /** Max requests per window per IP. 0 disables the limiter entirely. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

interface WindowEntry {
  windowStart: number;
  count: number;
}

/**
 * Register the per-IP rate-limit pre-handler. When `max` is 0 the hook is not
 * installed at all (zero per-request overhead when disabled).
 */
export function registerRateLimitMiddleware(
  fastify: FastifyInstance,
  opts: RateLimitOptions,
): void {
  if (opts.max <= 0) {
    return;
  }

  // ip → window state. A plain Map (not WeakMap) — IP strings aren't GC
  // anchors — so it's swept periodically to bound memory under many distinct
  // client IPs. unref() keeps the timer from holding the process open.
  const windows = new Map<string, WindowEntry>();

  const sweep = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [ip, entry] of windows) {
      if (entry.windowStart < cutoff) {
        windows.delete(ip);
      }
    }
  }, opts.windowMs);
  sweep.unref?.();

  fastify.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Health is exempt — liveness probes must never be throttled.
      const path = request.url.split("?")[0];
      if (path === "/health") {
        return;
      }

      const ip = request.ip || "unknown";
      const now = Date.now();
      let entry = windows.get(ip);
      if (!entry || now - entry.windowStart >= opts.windowMs) {
        entry = { windowStart: now, count: 0 };
        windows.set(ip, entry);
      }
      entry.count += 1;

      if (entry.count > opts.max) {
        const retryAfterSec = Math.max(
          1,
          Math.ceil((entry.windowStart + opts.windowMs - now) / 1000),
        );
        reply.header("Retry-After", String(retryAfterSec));
        request.log.warn(
          { ip, count: entry.count, max: opts.max, windowMs: opts.windowMs },
          "rate_limited",
        );
        return reply.code(429).send({ error: "rate_limited" });
      }
    },
  );
}
