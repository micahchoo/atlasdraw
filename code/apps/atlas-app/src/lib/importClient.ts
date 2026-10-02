// SPDX-License-Identifier: AGPL-3.0-only
//
// Run one import in a Web Worker (import.worker.ts), with progress and
// cancel. Cancel terminates the worker, which also stops any geocoding
// requests it has in flight.
//
// Where there is no Worker (a test environment), the pipeline runs on this
// thread; cancel then stops waiting for it, and its result is not used.

import { sizeRefusal, type ImportFormat } from "./importFormat";

import type { ImportOutcome, ImportProgress } from "./importPipeline";

export interface ImportWorkerRequest {
  file: File;
  format: ImportFormat;
  geocoderEndpoint?: string;
}

export type ImportWorkerReply =
  | { type: "progress"; progress: ImportProgress }
  | { type: "done"; outcome: ImportOutcome };

export interface ImportRun {
  signal?: AbortSignal;
  geocoderEndpoint?: string;
  onProgress?: (progress: ImportProgress) => void;
}

/** The rejection of a cancelled import. */
export function isImportCancelled(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function cancelled(): DOMException {
  return new DOMException("The import was cancelled.", "AbortError");
}

/**
 * Import one file. Resolves with the outcome; rejects only when `signal`
 * aborts (see isImportCancelled).
 */
export function importFileOffThread(
  file: File,
  format: ImportFormat,
  run: ImportRun = {},
): Promise<ImportOutcome> {
  const tooLarge = sizeRefusal(file);
  if (tooLarge) {
    return Promise.resolve({ ok: false, message: tooLarge });
  }
  if (run.signal?.aborted) {
    return Promise.reject(cancelled());
  }

  if (typeof Worker === "undefined") {
    return new Promise((resolve, reject) => {
      run.signal?.addEventListener("abort", () => reject(cancelled()), {
        once: true,
      });
      // On demand: a static import would put every parser in the editor's
      // boot chunk (importFormat.ts says why).
      void import("./importPipeline")
        .then(({ runImport }) =>
          runImport(file, format, {
            geocoderEndpoint: run.geocoderEndpoint,
            onProgress: run.onProgress,
          }),
        )
        .then(resolve);
    });
  }

  const worker = new Worker(new URL("./import.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      worker.terminate();
      reject(cancelled());
    };
    const finish = () => {
      worker.terminate();
      run.signal?.removeEventListener("abort", onAbort);
    };
    run.signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<ImportWorkerReply>) => {
      if (event.data.type === "progress") {
        run.onProgress?.(event.data.progress);
        return;
      }
      finish();
      resolve(event.data.outcome);
    };
    worker.onerror = (event) => {
      finish();
      console.error(`[import] worker failed for ${file.name}:`, event.message);
      resolve({
        ok: false,
        message: `${file.name}: import failed unexpectedly`,
      });
    };
    const request: ImportWorkerRequest = {
      file,
      format,
      geocoderEndpoint: run.geocoderEndpoint,
    };
    worker.postMessage(request);
  });
}
