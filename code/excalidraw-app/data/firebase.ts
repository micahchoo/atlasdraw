// stripped: Firebase per ADR 0006 (Phase 0 Task 9b).
// All exported functions replaced with no-ops that preserve caller signatures.
// Firebase SDK imports removed. Callers in Collab.tsx preserved — 6 usage sites
// (lines 160, 168, 299, 320, 728; data/index.ts:288) are structurally unchanged.
// Re-wire real backend in Phase 5 if collab returns.

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type { AppState, BinaryFileData } from "@excalidraw/excalidraw/types";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";

export const loadFirebaseStorage = async (): Promise<null> => null;

export const isSavedToFirebase = (
  _portal: Portal,
  _elements: readonly ExcalidrawElement[],
): boolean => true;

// eslint-disable-next-line no-empty-pattern
export const saveFilesToFirebase = async ({}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}): Promise<{ savedFiles: FileId[]; erroredFiles: FileId[] }> => ({
  savedFiles: [],
  erroredFiles: [],
});

export const saveToFirebase = async (
  _portal: Portal,
  _elements: readonly SyncableExcalidrawElement[],
  _appState: AppState,
): Promise<null> => null;

export const loadFromFirebase = async (
  _roomId: string,
  _roomKey: string,
  _socket: Socket | null,
): Promise<null> => null;

export const loadFilesFromFirebase = async (
  _prefix: string,
  _decryptionKey: string,
  _filesIds: readonly FileId[],
): Promise<{
  loadedFiles: BinaryFileData[];
  erroredFiles: Map<FileId, true>;
}> => ({
  loadedFiles: [],
  erroredFiles: new Map(),
});
