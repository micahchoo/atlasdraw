// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/realtime — structured logger (ISSUES.md Issue 8).
//
// Mirrors apps/storage/src/logger.ts's shape so both server apps log to the
// same structured/correlated standard — the relay previously logged
// exclusively via raw console.log/console.warn with no request/socket
// correlation.

import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "@atlasdraw/realtime" },
});
