// SPDX-License-Identifier: MIT
// Phase 3 Wave 1 Task 5 — thumbnail generator.
//
// Browser-only PNG generator for the .atlasdraw `meta/thumbnail.png` entry.
// CLI and test stubs receive `null` so the call site can pass the result
// straight to `write({ thumbnail })` regardless of runtime.

const THUMB_W = 1024;
const THUMB_H = 768;

/**
 * Render `canvas` into a 1024×768 PNG Blob, letterboxed on a white
 * background to preserve aspect ratio. Returns `null` outside the browser
 * (Node, Bun, vitest's "node" environment) so callers can wire this into
 * the `.atlasdraw` write path uniformly.
 */
export async function generateThumbnail(
  canvas: HTMLCanvasElement | null,
): Promise<Blob | null> {
  if (typeof document === "undefined") {
    return null;
  }
  if (!canvas) {
    return null;
  }
  if (typeof OffscreenCanvas === "undefined") {
    return null;
  }

  const off = new OffscreenCanvas(THUMB_W, THUMB_H);
  const ctx = off.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);

  const srcW = canvas.width || 1;
  const srcH = canvas.height || 1;
  const scale = Math.min(THUMB_W / srcW, THUMB_H / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const dx = (THUMB_W - drawW) / 2;
  const dy = (THUMB_H - drawH) / 2;
  ctx.drawImage(canvas, dx, dy, drawW, drawH);

  return await off.convertToBlob({ type: "image/png" });
}
