<!-- ADR-0008-MARKER: share-link-encoding -->

# ADR-0008: Share-Link Encoding — Two-Mode (URL-Hash vs Server Token)

- **Status:** Accepted
- **Date:** 2026-05-11
- **Phase:** 4 (MVP self-host) — server-token half implemented; URL-hash half scheduled for T8/T9
- **Supersedes:** none
- **Superseded by:** none
- **Related:** ADR-0006 (telemetry), ADR-0007 (storage dual-mode), ADR-0009 (error capture, T18)

## Context

Atlasdraw users need to share a map with another viewer in two distinct shapes:

1. **Small, ephemeral, no-server.** Sketch a few annotations on a base map, paste a link in chat, recipient views immediately. No account, no server registration of the share. Trustworthy: the URL itself carries the payload; revoking it is impossible (the URL is the secret).
2. **Large, persistent, server-backed.** A full map document with many features, layers, custom basemap, photos. Too large to fit in a URL. A server-issued short token resolves to the persisted document.

Both modes are user-initiated and consistent with the zero-telemetry posture of ADR-0006: there is no analytics layer in either path; the server only stores what the user explicitly uploads.

The two-mode split was committed during Phase 4 planning (plan §5 lines 269-270) and refined during T4 dispatch (server-token implementation shipped in commit `ddfa3b9`).

## Decision

### Mode A — URL-Hash (small maps, ≤ ~32 KB encoded)

The full `AtlasdrawDocument` JSON is:

1. Stringified.
2. Compressed with `lz-string`'s `compressToEncodedURIComponent`. This produces a URL-safe string that does not need further escaping.
3. Concatenated to the URL fragment: `https://<host>/m/#<lz-encoded>`.

The URL fragment is never sent to the server (HTTP-spec guarantee). Resolution is purely client-side: the atlas-app reads `window.location.hash` on load, decompresses, and renders.

Size budget: 32 KB encoded is the soft cap (browsers and link-preview crawlers handle this reliably; some chat tools truncate above ~40 KB). The atlas-app generates a URL-hash link when the encoded payload fits; otherwise it falls back to Mode B.

### Mode B — Server-Issued Token (any size up to the 50 MiB storage cap)

1. atlas-app uploads the document blob to the storage server via `POST /maps` (raw `application/octet-stream`).
2. The server returns a `MapRecord` with a `nanoid(21)` map id.
3. atlas-app calls `POST /maps/:id/share`. The server mints a `nanoid(21)` share token and persists a `ShareToken` row.
4. The server returns `{ token, url, expires_at }`. The URL is `${PUBLIC_URL}/m/${token}` (relative if `PUBLIC_URL` is empty).
5. Recipient navigates to the URL. atlas-app extracts the token, calls `GET /share/:token`, receives `{ map: MapRecord, mode: "read" }`, fetches the blob, and renders.

### Token entropy

`nanoid(21)` over the URL-safe alphabet `A-Za-z0-9_-` yields ~126 bits of entropy per token. This is sufficient for tokens that:

- Are non-secret in the cryptographic sense (anyone who has the URL has the map).
- Have a finite TTL (see below).
- Are not used as auth credentials (no privileges escalate from a token).

### TTL

**Server-issued share tokens expire after 7 days** (hardcoded in adapter `createShareToken` methods).

> **Drift note from plan §5 Open Question resolution (2026-05-03, line 1335)**: the
> original resolution called for a 30-day hardcoded TTL. T3 shipped 7 days during
> the 2026-05-11 implementation pass. ADR-0008 codifies 7 days as the accepted
> value going forward: more privacy-conservative, and resharing a 7-day-old
> link is no harder than minting a fresh one. The plan resolution is superseded
> by this ADR. A future `SHARE_TOKEN_TTL_DAYS` env knob (see Follow-ups) will
> make this operator-configurable; until then, code is canonical.

### Mode field is always "read"

In Phase 4, the `mode` field on every `ShareToken` is the literal string `"read"`. The HTTP route's `GET /share/:token` response sets `mode: "read"` from a hardcoded literal in the route handler, not from the database row. This is a defense-in-depth measure: even if a database row's `mode` column is tampered to `"write"`, the API surface returns `"read"`. The adversarial test `routes/share.test.ts` asserts this explicitly.

Write-capable share tokens are deferred to Phase 6 (multi-user editing), at which point the literal will be replaced with a server-set value drawn from a stricter enum.

### Path-traversal guard

Both `:id` and `:token` route parameters are validated against `/^[A-Za-z0-9_-]{21}$/` *before* any adapter call. Malformed inputs (`'../etc'`, `'..%2F'`, `'short'`, `'a'.repeat(22)`, illegal chars) return 400 with no adapter invocation. The adapter is never asked to look up a malformed id, even if the database/filesystem layer might tolerate it.

### Expired vs unknown — 410 vs 404

- Unknown token (never existed in the `share_tokens` table) returns **404**.
- Expired token (`expires_at` < now) returns **410 Gone**.
- Orphaned token (token row exists, but the referenced `map_id` has no corresponding `maps` row) returns **410 Gone**. The reasoning: the share was once valid; the underlying resource has been removed; "Gone" is more accurate than "Not Found."

## Consequences

**Positive:**

- Mode A (URL-hash) shares nothing with the server. Strong privacy property — the document never leaves the original client's machine (other than via the URL transport itself). Compatible with offline self-host.
- Mode B (server token) decouples the size of the share from the URL length. Short, copy-pasteable URLs.
- Token validation is regex-first, adapter-second. Path-traversal, length, and alphabet errors fail fast with no I/O.
- The `mode: "read"` server literal cannot be subverted by database tampering — a useful invariant when share-token tables might be backed up, replicated, or migrated.

**Negative / accepted costs:**

- **No revocation in MVP.** A shared link cannot be invalidated before its 7-day TTL expires. Operators who need to invalidate a share early have only nuclear options (delete the underlying map row, rotate the database).
- **Replay within TTL.** A token can be resolved any number of times in its 7-day window. This is intended (otherwise share-once tokens would break the obvious-use case of "send this to my team"), but it means a leaked URL leaks the document for up to 7 days.
- **Mode A reveals payload size to anyone with link-preview privileges** (chat apps, email scanners). The compressed blob is the URL — its length is visible.
- **Token existence-probing is theoretically possible** but infeasible in practice. 126-bit search space; even a rate-limited attacker would need cosmic time to find a single valid token.
- **`PUBLIC_URL=""` (default) means URLs in API responses are relative** (`/m/<token>`). Operators who serve the storage API at a different origin than atlas-app must set `PUBLIC_URL` or assemble the absolute URL client-side. The default is intentionally relative to avoid hard-coding hostnames into a default-build.

## Follow-ups

These are deliberate scope deferrals, not bugs:

- **`SHARE_TOKEN_TTL_DAYS` env knob.** Make TTL operator-configurable. Default stays 7. Phase 6 candidate; revisit if a self-host operator files a request.
- **Revocation API.** `DELETE /maps/:id/share/:token` or `POST /maps/:id/share/revoke`. Phase 6.
- **Single-use tokens** (e.g., for high-value one-time shares). Phase 6+. Requires a `used_at` column and a different threat model.
- **Write-mode share tokens.** Phase 6 multi-user editing; the `mode` literal becomes a server-set value from `{ "read", "write" }`.
- **URL-hash mode (T8/T9 implementation).** Currently scheduled for Wave 2. ADR is forward-looking on this half; codify implementation details once they land.

## Alternatives Considered

1. **Server-token only** (rejected) — would force every share to round-trip the server, blocking the "sketch and paste a link" use case from the casual GH-Pages tier (which has no storage server).
2. **URL-hash only** (rejected) — caps share size below ~32 KB. Many real maps (with photos, custom basemaps, dozens of annotations) exceed this. Forces those users to install a self-host.
3. **JWT-style signed tokens** with embedded TTL and scope (rejected) — adds a signing-key management burden for every self-host operator. Random opaque tokens with server-side expiry rows are simpler and adequate at this entropy.
4. **UUIDv4 tokens** (rejected — chose nanoid) — UUIDv4 strings are 36 chars (with hyphens) vs nanoid 21. Same entropy class; shorter is better for URLs.
5. **Brotli or zstd compression for URL-hash mode** (rejected — chose lz-string) — neither has a stable, well-supported JS-and-browser implementation with the URL-safe output that lz-string ships out of the box. The compression-ratio win is small at the size budget we care about.
6. **Single-use tokens by default** (rejected) — breaks "send to team" use case; replay-protection is a separate feature, not a default.
7. **No expiry** (rejected) — accumulates indefinite shared-link state. Database grows unbounded. Privacy posture degrades over time (links shared in 2026 still live in 2030).

## Verification

- `code/apps/storage/src/routes/share.ts` — server-token mode implementation.
- `code/apps/storage/src/routes/share.test.ts` — 18 adversarial tests: 410 expired, 410 orphaned, 404 unknown, 400 malformed, mode-always-read literal, DB-tampered mode='write' row still returns "read", traversal guards.
- `code/apps/storage/src/adapters/{sqlite-fs,postgres-minio}.ts` — `createShareToken` hard-codes 7-day TTL (`expires_at = now + 7d`).
- `code/apps/storage/src/config.ts` — `PUBLIC_URL` defaults to `""` (relative).
- URL-hash mode: pending T8/T9 implementation; ADR captures the spec.
