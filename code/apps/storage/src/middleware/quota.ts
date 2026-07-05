// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — Phase 6 A13b: per-workspace quota guard.
//
// Fastify preHandler. Runs AFTER the workspace middleware in managed mode:
//   - self-host (managed=false): no-op. Returns immediately, every route
//     stays workspace-agnostic exactly as in Phase 4.
//   - managed mode (managed=true): for routes in `gatedRoutes`, look up
//     the requesting workspace's plan, count its maps, and 402 the
//     request if it would exceed the plan's map cap.
//
// Quota breaches emit a `quota_breach` pino event per ADR-0011 — payload
// fields exactly as in the ADR table:
//   {workspaceId, quotaType, attemptedValue, limit, timestamp}
//
// Only the `/maps` POST is gated in v1. Adding more quota types later
// (members, share-tokens, blob-bytes) means extending `gatedRoutes`.

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { StorageClient, Workspace, WorkspacePlan } from "../types";

export interface QuotaLimits {
  free: number;
  pro: number;
}

export interface QuotaMiddlewareOptions {
  /** True iff the server runs in hosted-mode. */
  managed: boolean;
  /** Storage adapter — used to look up workspaces + count their maps. */
  client: StorageClient;
  /** Map-count limits per plan tier. Sourced from config at boot. */
  limits: QuotaLimits;
}

/** Decide the cap for a given workspace plan. */
function capForPlan(plan: WorkspacePlan, limits: QuotaLimits): number {
  switch (plan) {
    case "free":
      return limits.free;
    case "pro":
      return limits.pro;
  }
}

/**
 * Register the quota pre-handler. Idempotent — call once.
 *
 * In self-host (`managed=false`) the hook is still registered but
 * short-circuits on the very first line, so the overhead is one branch
 * per request. We register-then-short-circuit (rather than skip
 * registration) so that flipping MANAGED_MODE in env doesn't require a
 * code-path rewire.
 */
export function registerQuotaMiddleware(
  fastify: FastifyInstance,
  opts: QuotaMiddlewareOptions,
): void {
  fastify.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!opts.managed) {
        return;
      }

      // Only POST /maps is gated in v1. Note: route `routeOptions.url` may
      // be undefined when the hook fires before route matching completes
      // for 404s — fall back to raw URL pathname.
      const method = request.method;
      const url = request.url.split("?")[0];
      if (!(method === "POST" && url === "/maps")) {
        return;
      }

      const workspaceId = request.workspace;
      if (!workspaceId) {
        // workspace middleware already 401'd in managed mode; this branch
        // only reachable if the order is broken. Be defensive.
        return reply.code(401).send({ error: "WORKSPACE_REQUIRED" });
      }

      const ws: Workspace | null = await opts.client.getWorkspace(workspaceId);
      if (!ws) {
        // Managed-mode header points at a workspace that doesn't exist
        // in the workspaces table. Reject loudly — better than silently
        // attaching maps to a phantom workspace.
        return reply.code(404).send({ error: "workspace_not_found" });
      }

      const current = await opts.client.countWorkspaceMaps(workspaceId);
      const max = capForPlan(ws.plan, opts.limits);

      if (current >= max) {
        // ADR-0011: server-side `quota_breach` event. Emitted via the
        // request's pino logger so it inherits the request-id correlation.
        request.log.info(
          {
            workspaceId,
            quotaType: "maps",
            attemptedValue: current + 1,
            limit: max,
            timestamp: new Date().toISOString(),
          },
          "quota_breach",
        );
        return reply.code(402).send({
          error: "quota_exceeded",
          limit: "maps",
          current,
          max,
        });
      }
    },
  );
}
