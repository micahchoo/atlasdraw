// SPDX-License-Identifier: MIT
// Local vitest config — overrides the root config so the protocol package
// runs against a Node environment (no jsdom, no Excalidraw setupTests).
// Web Crypto is available on `globalThis.crypto` in Node 20+.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
