/** The adapters' "not found" error, as the map service recognises it. */
export function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("not found:");
}
