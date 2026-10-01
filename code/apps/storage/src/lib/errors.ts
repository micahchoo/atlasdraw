/** The adapters' "not found" error, as the map service recognises it. */
export function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("not found:");
}

/** The adapters' "over the size cap" error. Nothing was stored. */
export function storageFull(): Error {
  return new Error("storage full");
}

export function isFullError(err: unknown): boolean {
  return err instanceof Error && err.message === "storage full";
}
