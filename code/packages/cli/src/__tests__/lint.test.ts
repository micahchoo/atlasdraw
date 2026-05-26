// SPDX-License-Identifier: MIT
// packages/cli/src/__tests__/lint.test.ts
// Phase 3 Wave 2 T10 — vitest suite for `runLint`.
//
// Strategy: build .atlasdraw fixtures in a temp dir using `write()` from
// @atlasdraw/data, then drive `runLint` directly with mock streams. We assert
// on the return value (would-be exit code) and the captured stream writes.
//
// Why temp files instead of in-memory injection: the public contract from the
// plan is "atlasdraw lint <file>" — the file argument is part of the surface,
// and `fs.readFile` failure modes (ENOENT) are part of the test matrix. A
// memfs-backed reader would skip the path that's actually shipped.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";

import { write, ManifestSchema, type AtlasdrawDocument } from "@atlasdraw/data";

import { runLint } from "../commands/lint.js";

/** Capture-and-assert stdio adapter. */
function makeStreams() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    streams: {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void err.push(s) },
    },
    out,
    err,
  };
}

/** Minimal valid manifest (parsed → defaults applied). */
function makeManifest(overrides: Record<string, unknown> = {}) {
  const base = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    version: 1 as const,
    title: "Test Atlas",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    basemap: { type: "registry" as const, id: "default" },
    camera: {
      center: [0, 0] as [number, number],
      zoom: 1,
      bearing: 0,
      pitch: 0,
    },
    layers: [],
    permissions: { publicView: false },
    ...overrides,
  };
  return ManifestSchema.parse(base);
}

function makeDoc(): AtlasdrawDocument {
  return {
    manifest: makeManifest(),
    scene: [],
    layers: new Map(),
    styleRef: null,
    files: new Map(),
  };
}

/**
 * Build a malformed-manifest fixture by:
 *   1. Writing a valid doc via `write()` to get a real .atlasdraw zip,
 *   2. Cracking it open and replacing `manifest.json` with the desired
 *      malformed bytes,
 *   3. Re-zipping.
 * Sidesteps `write()`'s own validation (it accepts a parsed Manifest, so we
 * can't ask it to emit version=2 directly).
 */
async function buildFixtureWithRawManifest(
  rawManifest: unknown,
): Promise<Buffer> {
  const blob = await write(makeDoc());
  const buf = Buffer.from(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);
  zip.file("manifest.json", JSON.stringify(rawManifest, null, 2));
  const out = await zip.generateAsync({ type: "uint8array" });
  return Buffer.from(out);
}

describe("atlasdraw lint", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `atlasdraw-cli-test-${crypto.randomUUID()}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 and prints OK summary for a valid .atlasdraw", async () => {
    const blob = await write(makeDoc());
    const buf = Buffer.from(await blob.arrayBuffer());
    const file = path.join(tmpDir, "valid.atlasdraw");
    await fs.writeFile(file, buf);

    const { streams, out, err } = makeStreams();
    const code = await runLint({ file }, streams);

    expect(code).toBe(0);
    expect(err.join("")).toBe("");
    expect(out.join("")).toMatch(
      /^OK: manifest version 1, id [0-9A-HJKMNP-TV-Z]{26}, title '.+'\n$/,
    );
    expect(out.join("")).toContain("title 'Test Atlas'");
  });

  it("returns 1 and prints per-field zod error when manifest is missing id", async () => {
    const valid = makeManifest();
    const { id: _id, ...withoutId } = valid as Record<string, unknown>;
    void _id;
    const buf = await buildFixtureWithRawManifest(withoutId);
    const file = path.join(tmpDir, "no-id.atlasdraw");
    await fs.writeFile(file, buf);

    const { streams, out, err } = makeStreams();
    const code = await runLint({ file }, streams);

    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("manifest.json: id: Required");
  });

  it("returns 1 and prints version error when manifest version is 2", async () => {
    const buf = await buildFixtureWithRawManifest({
      ...makeManifest(),
      version: 2,
    });
    const file = path.join(tmpDir, "v2.atlasdraw");
    await fs.writeFile(file, buf);

    const { streams, out, err } = makeStreams();
    const code = await runLint({ file }, streams);

    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain(
      "manifest.json: version: Invalid literal value, expected 1",
    );
  });

  it("returns 1 with 'File not found:' when the path does not exist", async () => {
    const file = path.join(tmpDir, "nope.atlasdraw");
    const { streams, out, err } = makeStreams();
    const code = await runLint({ file }, streams);

    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain(`File not found: ${file}`);
  });
});
