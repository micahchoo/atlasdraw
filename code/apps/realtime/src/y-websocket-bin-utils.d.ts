// SPDX-License-Identifier: AGPL-3.0-only
// Type declarations for y-websocket/bin/utils (CJS — no upstream .d.ts
// for the subpath export). Kept in sync with the actual signatures in
// node_modules/y-websocket/bin/utils.cjs.

declare module "y-websocket/bin/utils" {
  import type { IncomingMessage } from "http";
  import type { WebSocket } from "ws";

  /**
   * Options for {@link setupWSConnection}.
   */
  interface SetupOptions {
    docName?: string;
    gc?: boolean;
  }

  /**
   * Sets up a WebSocket connection for Yjs document synchronization.
   *
   * Manages the Y.Doc lifecycle via the internal `docs` map, awareness
   * protocol, and ping/pong keep-alive.  Automatically creates the doc
   * if it does not already exist.
   *
   * @param conn  - The upgraded WebSocket connection.
   * @param req   - The original HTTP upgrade request.
   * @param opts  - Optional settings (docName defaults to the URL path).
   */
  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    opts?: SetupOptions,
  ): void;

  /**
   * In-memory map of active Yjs documents, keyed by room/document name.
   * Managed by {@link setupWSConnection}; exposed so consumers can
   * implement eviction or persistence.
   */
  export const docs: Map<string, import("yjs").Doc>;
}
