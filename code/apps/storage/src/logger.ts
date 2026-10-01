// @atlasdraw/storage — structured logger (pino).
//
// A share token is a read capability, and it travels in the URL
// (`/share/<token>/blob`). The request serializer writes `/share/[redacted]`,
// so no log level ever holds one. A write key travels only in the
// `Authorization` header, which no serializer here writes.

import { pino } from "pino";

import type { DestinationStream, Logger } from "pino";

const SHARE_SEGMENT = /\/share\/[^/?#]+/g;

/** The URL with every share token replaced by `[redacted]`. */
export function redactUrl(url: string): string {
  return url.replace(SHARE_SEGMENT, "/share/[redacted]");
}

interface LoggedRequest {
  method?: string;
  url?: string;
  ip?: string;
  host?: string;
}

const serializers = {
  req(req: LoggedRequest) {
    return {
      method: req.method,
      url: redactUrl(req.url ?? ""),
      host: req.host,
      remoteAddress: req.ip,
    };
  },
};

export function createLogger(
  level = "info",
  destination?: DestinationStream,
): Logger {
  const options = {
    level,
    base: { service: "@atlasdraw/storage" },
    serializers,
  };
  return destination ? pino(options, destination) : pino(options);
}

/** The process logger, for code that runs outside a request. */
export const logger = createLogger(process.env.LOG_LEVEL ?? "info");
