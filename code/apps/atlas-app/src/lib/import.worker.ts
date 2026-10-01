// SPDX-License-Identifier: AGPL-3.0-only
//
// The import worker: runs the import pipeline off the main thread, so a large
// file does not freeze the editor. One message in (the file), progress
// messages out, then one result. importClient.ts owns its lifetime and
// terminates it to cancel.

import { runImport } from "./importPipeline";

import type { ImportFormat } from "./importFormat";

import type { ImportWorkerReply, ImportWorkerRequest } from "./importClient";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ImportWorkerRequest>) => void) | null;
  postMessage: (message: ImportWorkerReply) => void;
};

scope.onmessage = (event) => {
  const { file, format, geocoderEndpoint } = event.data;
  void runImport(file, format as ImportFormat, {
    geocoderEndpoint,
    onProgress: (progress) => scope.postMessage({ type: "progress", progress }),
  }).then((outcome) => scope.postMessage({ type: "done", outcome }));
};
