/**
 * The public library site and its submission backend. Atlasdraw builds set
 * neither, so the library UI must hide what would otherwise link to
 * "undefined".
 */
const configured = (value: string | undefined): string | null =>
  value ? value : null;

export const libraryBrowseUrl = (): string | null =>
  configured(import.meta.env.VITE_APP_LIBRARY_URL);

export const libraryBackendUrl = (): string | null =>
  configured(import.meta.env.VITE_APP_LIBRARY_BACKEND);
