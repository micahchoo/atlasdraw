/** Storage adapter "not found" discriminator shared across route modules. */
export function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("not found:");
}
