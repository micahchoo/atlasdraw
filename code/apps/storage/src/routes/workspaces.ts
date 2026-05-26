// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — Phase 6 A13b: workspaces routes.
//
// Two endpoints — both managed-mode only. Self-host servers return 404
// (the feature is hidden, exactly as ADR-0011 intends for the OSS build).
//
//   GET  /api/workspaces  — list all workspaces. Phase 6 v1 has no user
//                           auth so this returns every row; post-v1
//                           a scope-by-user gate goes here.
//   POST /api/workspaces  — create a free-tier workspace. Emits
//                           `workspace_created` per ADR-0011.

import { nanoid } from "nanoid";

import type { FastifyInstance } from "fastify";
import type { StorageClient } from "../types";

export interface WorkspaceRoutesOptions {
  managed: boolean;
  client: StorageClient;
}

export function registerWorkspaceRoutes(
  fastify: FastifyInstance,
  opts: WorkspaceRoutesOptions,
): void {
  fastify.get("/api/workspaces", async (_request, reply) => {
    if (!opts.managed) {
      return reply.code(404).send({ error: "not found" });
    }
    const workspaces = await opts.client.listWorkspaces();
    return reply.code(200).send({ workspaces });
  });

  fastify.post<{ Body: { name?: string } }>(
    "/api/workspaces",
    async (request, reply) => {
      if (!opts.managed) {
        return reply.code(404).send({ error: "not found" });
      }
      const body = (request.body ?? {}) as { name?: string };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return reply.code(400).send({ error: "name_required" });
      }
      const id = nanoid(21);
      const workspace = await opts.client.createWorkspace({
        id,
        name,
        plan: "free",
      });
      // ADR-0011: `workspace_created` event — operator-internal pino log.
      request.log.info(
        {
          workspaceId: workspace.id,
          plan: workspace.plan,
          timestamp: workspace.created_at,
        },
        "workspace_created",
      );
      return reply.code(201).send(workspace);
    },
  );
}
