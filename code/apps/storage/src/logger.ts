// @atlasdraw/storage — Phase 4 T18: structured logger.
//
// Single pino instance exported for both Fastify's request log and direct
// import by route handlers / adapters. Level is env-controlled via LOG_LEVEL.

import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "@atlasdraw/storage" },
});
