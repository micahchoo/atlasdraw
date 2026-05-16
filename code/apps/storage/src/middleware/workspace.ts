// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — Phase 6 A9: workspace abstraction middleware.
//
// Reads `X-Workspace-ID` from incoming requests and attaches an opaque
// branded WorkspaceId to `request.workspace`. Two modes:
//
//   - managed mode (config.MANAGED_MODE=true)
//       Header is REQUIRED on every protected route. Missing header →
//       responds 401 { error: "WORKSPACE_REQUIRED" }.
//
//   - self-host mode (config.MANAGED_MODE=false, the default)
//       No-op. `request.workspace` is left `undefined` and downstream
//       routes treat absence as "default tenant" — preserving Phase 4
//       backward compatibility for null-workspace records.
//
// Per Q-P6-1, the workspace value at this layer is opaque — DB-backed
// validation lives in Wave 3 A13b, not here.

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

/**
 * Opaque branded workspace identifier. The value at this layer is treated
 * as a string by the storage app; future Wave 3 work will validate it
 * against a workspaces table.
 */
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };

/**
 * Mint a WorkspaceId from a raw header string. The brand is purely a
 * compile-time gate — at runtime this is the same string. Keep the cast
 * narrow so accidental string→WorkspaceId widening stays grep-able.
 */
export function asWorkspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}

// Augment Fastify's request shape so route handlers can read
// `request.workspace` without `any` casts.
declare module "fastify" {
  interface FastifyRequest {
    workspace?: WorkspaceId;
  }
}

export interface WorkspaceMiddlewareOptions {
  /** True iff the server runs in hosted-mode. */
  managed: boolean;
}

const WORKSPACE_HEADER = "x-workspace-id";

/**
 * Register the workspace pre-handler hook on `fastify`. Applied at the
 * app level by `index.ts` — health route is registered before this hook
 * runs, so it remains header-agnostic.
 */
export function registerWorkspaceMiddleware(
  fastify: FastifyInstance,
  opts: WorkspaceMiddlewareOptions,
): void {
  fastify.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Health route bypasses workspace gating — operators / liveness
      // probes must be able to hit /health without provisioning a
      // workspace. Any future public endpoint should be added here.
      if (request.url === "/health" || request.url.startsWith("/health?")) {
        return;
      }

      const raw = request.headers[WORKSPACE_HEADER];
      const header = Array.isArray(raw) ? raw[0] : raw;

      if (opts.managed) {
        if (!header || typeof header !== "string" || header.length === 0) {
          return reply.code(401).send({ error: "WORKSPACE_REQUIRED" });
        }
        request.workspace = asWorkspaceId(header);
        return;
      }

      // Self-host: best-effort attach if the header is present (useful
      // for testing the managed code path locally), but never require.
      if (typeof header === "string" && header.length > 0) {
        request.workspace = asWorkspaceId(header);
      }
    },
  );
}
