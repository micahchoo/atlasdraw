// Atlasdraw: a host that serves its own fonts lists no CDN copy. The CDN
// fallback (esm.sh) made the app's content security policy admit a third
// origin for fonts, for a package that is private and never published there.
//
// setupTests.ts sets window.EXCALIDRAW_ASSET_PATH (a file:// folder) and
// does not let a test change it, so this is the string case. The list case
// takes the same branch in createUrls.

import { describe, expect, it } from "vitest";

import { ExcalidrawFontFace } from "./ExcalidrawFontFace";

describe("ExcalidrawFontFace urls", () => {
  it("lists only the host's copy when the host sets an asset path", () => {
    expect(typeof window.EXCALIDRAW_ASSET_PATH).toBe("string");
    const face = new ExcalidrawFontFace("Virgil", "/assets/Virgil-abc.woff2");
    expect(face.urls.map(String)).toEqual([
      `${window.EXCALIDRAW_ASSET_PATH}assets/Virgil-abc.woff2`,
    ]);
  });
});
