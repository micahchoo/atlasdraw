// SPDX-License-Identifier: MIT
// packages/cli/src/commands/lint.ts
// Phase 3 Wave 2 T10 — `atlasdraw lint <file>` subcommand.
//
// Validates a `.atlasdraw` file end-to-end:
//   1. Reads the file from disk.
//   2. Hands the bytes to `read()` from @atlasdraw/data, which opens the zip
//      and validates `manifest.json` against `ManifestSchema`.
//   3. On `INVALID_MANIFEST`, re-parses the raw manifest with
//      `ManifestSchema.safeParse()` to surface per-field zod errors with the
//      `manifest.json: <path>: <message>` line format the plan promises.
//
// `runLint(args, streams)` returns the would-be exit code rather than calling
// `process.exit()` itself — this keeps the function unit-testable. The
// Commander action wrapper at the bottom of this file is the only place that
// calls `process.exit()`.

import { promises as fs } from "node:fs";
import { Command } from "commander";
import JSZip from "jszip";
import {
  read,
  AtlasdrawFormatError,
  ManifestSchema,
} from "@atlasdraw/data";

export interface LintStreams {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

/**
 * Run the lint workflow against a single file path.
 *
 * Returns a numeric exit code instead of calling `process.exit()` so tests can
 * assert on streams + return value. The Commander wrapper turns the return
 * value into a real process exit.
 */
export async function runLint(
  args: { file: string },
  streams: LintStreams,
): Promise<number> {
  const { file } = args;

  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EISDIR") {
      streams.stderr.write(`File not found: ${file}\n`);
      return 1;
    }
    streams.stderr.write(
      `File not found: ${file} (${(err as Error).message ?? String(err)})\n`,
    );
    return 1;
  }

  // Wrap as Blob — `read()` expects a Blob. Node 20+ exposes a global Blob;
  // the workspace already requires that (jsdom + vitest 3 + @atlasdraw/data
  // ship the same assumption), so we use it directly.
  // Cast through unknown to satisfy the BlobPart signature: Buffer is a
  // Uint8Array at runtime, but its typing varies between @types/node releases.
  const blob = new Blob([buf as unknown as BlobPart]);

  try {
    const doc = await read(blob);
    streams.stdout.write(
      `OK: manifest version ${doc.manifest.version}, id ${doc.manifest.id}, title '${doc.manifest.title}'\n`,
    );
    return 0;
  } catch (err) {
    if (!(err instanceof AtlasdrawFormatError)) {
      // Unknown error — surface verbatim. Should be rare; `read()` wraps its
      // own failure modes in `AtlasdrawFormatError`.
      streams.stderr.write(
        `${(err as Error).name ?? "Error"}: ${(err as Error).message ?? String(err)}\n`,
      );
      return 1;
    }

    if (err.code !== "INVALID_MANIFEST") {
      streams.stderr.write(`${err.code}: ${err.message}\n`);
      return 1;
    }

    // INVALID_MANIFEST: re-parse the raw manifest to harvest per-field zod
    // errors. `read()` collapses all zod issues into one prose string, but
    // for the CLI we want one line per field so the user can find each
    // failure quickly.
    const detailed = await formatManifestErrors(buf);
    if (detailed.length === 0) {
      // Couldn't recover the per-field detail (e.g. manifest JSON itself was
      // unparseable). Fall back to the wrapped message.
      streams.stderr.write(`${err.code}: ${err.message}\n`);
      return 1;
    }
    for (const line of detailed) {
      streams.stderr.write(`${line}\n`);
    }
    return 1;
  }
}

/**
 * Crack the zip open ourselves to fish out `manifest.json`, then run
 * `ManifestSchema.safeParse()` and format each issue as
 * `manifest.json: <fieldPath>: <message>`. Returns `[]` if we can't reach a
 * structured failure (the caller falls back to the wrapped message).
 */
async function formatManifestErrors(buf: Buffer): Promise<string[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return [];
  }
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) {
    return [];
  }
  let manifestJson: unknown;
  try {
    const text = await manifestEntry.async("string");
    manifestJson = JSON.parse(text);
  } catch {
    return [];
  }
  const parsed = ManifestSchema.safeParse(manifestJson);
  if (parsed.success) {
    return [];
  }
  return parsed.error.errors.map((issue) => {
    const fieldPath = issue.path.join(".");
    return `manifest.json: ${fieldPath}: ${issue.message}`;
  });
}

export const lintCommand = new Command("lint")
  .description("Validate an .atlasdraw file's structure and manifest")
  .argument("<file>", "path to a .atlasdraw file")
  .action(async (file: string) => {
    const code = await runLint(
      { file },
      { stdout: process.stdout, stderr: process.stderr },
    );
    process.exit(code);
  });
