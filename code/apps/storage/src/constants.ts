// Shared constants for @atlasdraw/storage.
// nanoid v3 default alphabet: A-Z a-z 0-9 _ -; default size 21.
// Both map ids and share tokens are minted via nanoid(21).
export const ID_RE = /^[A-Za-z0-9_-]{21}$/;

// Share link TTL: 7 days (adapter-owned, enforced at resolve-time).
export const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
