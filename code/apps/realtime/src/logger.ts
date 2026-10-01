// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — structured logger.
//
// Same shape as apps/storage/src/logger.ts, so both server apps write the
// same structured pino log.

import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "@atlasdraw/realtime" },
});
