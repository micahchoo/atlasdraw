# Atlasdraw — Security Model

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.
**Schema:** codebase-mapping-schema.md § Security
**Last updated:** 2026-05-03

---

## Overview

This document describes Atlasdraw's security model: who is protecting whose data from whom, what mechanisms are in place, and where the residual risks and known gaps lie.

[CONFIDENCE: high] marks claims derived directly from the tech spec, open-questions resolutions, and escalations documents. [CONFIDENCE: med] marks extrapolations from phase plans where the spec is silent.

---

## Threat Model

### Deployment Contexts

Atlasdraw operates in three distinct deployment contexts, each with a different threat model:

| Context | Operator | Users | Primary Threat |
|---|---|---|---|
| **Self-hosted, single user** | The user is the operator | Themselves | No multi-user threat; local data only |
| **Self-hosted, collaborative** | A team or organization | Known internal users | Insider access to data in transit; relay server access to collaboration traffic |
| **Hosted flagship (`app.atlasdraw.org`)** | Atlasdraw | Arbitrary public users | Users accessing each other's maps; relay reading collaboration payloads |

### What Atlasdraw Protects

1. **Annotation content** from relay server operators (E2EE via Excalidraw's AES-GCM model).
2. **User maps** from other users on the hosted platform (per-workspace isolation, share tokens).
3. **Embed viewers** from the embedding page accessing map internals (postMessage API surface only).
4. **Plugin behavior** from exfiltrating user data or making unauthorized network calls (Worker sandbox + permission model).

### What Atlasdraw Does NOT Protect (Explicit Out-of-Scope)

- **Camera and cursor positions** — these are plaintext at the relay by design (see §Camera and Cursor below).
- **Mapeo-style adversarial server scenarios** (indigenous data sovereignty, hostile relay operators) — the PRD notes this use case is out-of-scope for v1. The v1 threat model assumes the relay is operated by a party the collaboration room owner trusts.
- **Plugin authors acting in bad faith** in an open marketplace — the v1.5 sandbox is appropriate for known-party plugin authors on a self-hosted instance; it is not sufficient for anonymous authors in an open marketplace (see §Plugin Sandbox).

---

## Annotation E2EE (Excalidraw Model)

**Mechanism:** Room key in URL fragment, AES-GCM client-side encryption
**Phases:** 5 (collab), inherits Excalidraw's existing model
**Source:** Tech Spec §5.3 [CONFIDENCE: high]

### How It Works

Excalidraw's existing E2EE model is inherited without modification:

1. When a user creates a collaboration room, a random room key is generated client-side.
2. The room key is stored only in the URL fragment (`#room=ROOM_ID,KEY`).
3. All `SCENE_UPDATE` payloads are encrypted with AES-GCM before being emitted to the relay.
4. `COMMENT` payloads (Phase 6) are also encrypted with the same room key.
5. The relay receives only `{ iv, ciphertext }` and retransmits it; the relay never holds the plaintext key.

### Trust Boundary

The URL fragment is not sent in HTTP requests (browser behavior). The room key is never transmitted to the server. A relay operator who controls the server can observe:
- That a room exists and who is connected (by socket identity)
- The frequency and approximate size of scene updates
- All camera and cursor data (plaintext)
- **Not:** the content of annotations or comments

### Share Link Interaction

Share links expose map content to the recipient. When a map is shared, the recipient must also receive the room key (embedded in the URL). This means the sharing URL must include the fragment key for the recipient to decrypt the map. The share link is therefore sensitive — it is a bearer credential for read access plus decryption.

---

## Yjs Data Layer E2EE — E-01 OPEN GAP

**Mechanism:** Server-trusted relay (Phase 5 provisional); Option B evaluation deferred to Phase 6
**Phases:** 5 ships server-trusted; Phase 6 gate on E-01 resolution
**Source:** E-01 escalation, Phase 5 Task 0, ADR `0007-yjs-e2ee-threat-model.md` [CONFIDENCE: high]

### Current State (Phase 5)

The Yjs data-layer relay (`/yjs/:roomId`, y-websocket) operates in **server-trusted mode** in Phase 5. The relay server can read plaintext GeoJSON feature operations. This is Option C from the escalation.

`yjs-crypto.ts` ships as a stub with the correct API (`encryptUpdate`, `decryptUpdate`) but no implementation (returns input unchanged). The stub is tested against its API contract only.

### Residual Risk During the Gap

Anyone who operates the relay server can read:
- All feature coordinates, geometry, and properties being edited in data layers
- The complete edit history of any data layer in a room

This is the same visibility that Excalidraw's legacy (non-E2EE) collab mode provides. It is documented explicitly in ADR `0007` as the Phase 5 scope statement.

### Phase 6 Gate (E-01)

ADR `0007-yjs-e2ee-threat-model.md` must be reviewed and merged before Phase 5 ships. Phase 6 must resolve E-01:

- **Option A confirmed (server-trusted is acceptable for the target deployment):** Drop `yjs-crypto.ts`, remove stub, amend ADR, close E-01.
- **Option B selected (client-side Yjs encryption required):** Replace `setupWSConnection` with a custom log-replay handler; wire `yjs-crypto.ts` against the room key from the URL fragment.

Until E-01 is resolved, the Yjs data-layer relay is a known plaintext surface for relay operators.

---

## Camera and Cursor — Plaintext by Design

**Source:** Tech Spec §5.3 [CONFIDENCE: high]

`MAP_CAMERA_UPDATE` and `CURSOR` events travel plaintext on the relay. The relay uses them for:
- Throttling and deduplication (camera: 30 Hz cap; cursor: 60 Hz cap)
- Broadcasting to other room members

These fields are treated as non-sensitive. The data they carry (`{lng, lat, zoom, bearing, pitch}` and `{userId, lngLat, color}`) reveals where users are looking but not what they are annotating.

**Mapeo-style use case:** For deployments where revealing user position to a relay operator is unacceptable (e.g., indigenous land-rights mapping), this model is insufficient. That use case is explicitly out-of-scope for v1. A future v2 option could encrypt camera/cursor with a separate lightweight key, but this is not on the roadmap.

---

## Share Token Model

**Mechanism:** Opaque bearer token, 30-day TTL, server-side scope enforcement
**Phase:** 4 (share endpoints) [CONFIDENCE: high — from Phase 4 Task 4]

### Token Properties

| Property | Value |
|---|---|
| Format | `nanoid(21)` — 126-bit entropy |
| TTL | 30 days (hardcoded; configurable in future) |
| Scope | `mode: "read"` — server-set, never from request input |
| Storage | Database row (opaque, not signed) |
| Revocation | Delete the token row; no UI in v1.0 (known gap per ADR `0008`) |
| Expiry response | 410 Gone (distinguishable from 404 "never existed") |

**No JWT.** Share tokens are opaque random strings, not signed tokens. JWT is not used because:
- Revocation requires a blocklist with JWT (defeating the purpose of signed tokens)
- The server must look up the token anyway (for scope, owner, TTL)
- Opaque random tokens with DB lookup are simpler and revocable by row delete

### Adversarial Sub-checks (per adversarial-api-testing skill applied in Phase 4)

1. Token entropy is adequate (126 bits, non-guessable within TTL).
2. TTL is enforced server-side; the client cannot extend it.
3. The `mode` field is set from the stored `ShareToken.mode`, never from request input — a client cannot escalate from read to write by crafting a request.
4. URL hash share links (tiny maps) do not go through the token system; they carry the map bundle in the URL fragment itself. The bundle is the bearer credential.

---

## Plugin Sandbox (Phase 7)

**Mechanism:** Web Worker + postMessage bridge + prelude override + permission grammar
**Phase:** 7 (v1.5) [CONFIDENCE: high — from Phase 7 research Q: W0-1b, plan Task 2]

### Defense-in-Depth (v1.5)

The plugin sandbox in v1.5 uses a same-origin Web Worker with a prelude that overrides or nulls dangerous globals:

```
self.fetch       → permission-checked wrapper
self.XMLHttpRequest → undefined
self.WebSocket   → undefined
self.importScripts → throw (or no-op)
dynamic import() → cannot be blocked in JS; rely on CSP
```

The prelude runs before the plugin's entry module. A plugin that attempts to use `XMLHttpRequest`, `WebSocket`, or `importScripts` directly will receive `undefined` or a thrown error.

`fetch` is replaced with a wrapper that checks the requested host against the plugin's declared `fetch:<host>` permissions. A fetch to an unlisted host is rejected with a permissions error, not silently dropped.

### Permission Grammar

```
PermissionId = "read:layers" | "read:camera" | "write:layers" | "fetch:<host>"
```

- `fetch:*` wildcard is disallowed at manifest validation time (throws at install).
- Permissions are declared in `manifest.json` and shown to the user at install time via `PluginPermissionDialog`.
- Granted permissions are stored per-plugin and passed to the Worker prelude on spawn.

### Known Limitation — Not Origin Isolation

[CONFIDENCE: high] The v1.5 sandbox is **not origin isolation**. A plugin running in a same-origin Worker retains access to:
- Same-origin endpoints (the Worker's `fetch` wrapper allows same-origin if `read:layers` or similar is granted)
- CSP-permitted script sources (if the host CSP is permissive)
- `SharedArrayBuffer` and other shared-memory primitives if `Cross-Origin-Opener-Policy` is not set

True origin isolation requires hosting the plugin Worker in a cross-origin iframe on a separate subdomain (e.g., `plugins.atlasdraw.app`). This is the **v2 plugin hardening milestone**, explicitly recorded in the Phase 7 produces contract.

**Appropriate deployment:** The v1.5 sandbox is appropriate for self-hosted single-tenant deployments where plugin authors are known parties. It is **not sufficient** for an open marketplace with anonymous plugin authors.

### CSP for Plugin Host

The application serving the plugin host must set a restrictive CSP. Minimum required:

```
Content-Security-Policy: 
  default-src 'self';
  script-src 'self' blob:;     /* blob: for Worker instantiation */
  worker-src 'self' blob:;
  connect-src 'self' <explicitly-listed-fetch-allowed-hosts>;
```

`blob:` is required for `new Worker(blob:url, ...)` instantiation. Without it, Worker spawning fails. This is documented in Phase 7 implementation notes.

---

## Embed SDK Security

**Mechanism:** `<iframe>` isolation + postMessage API surface only
**Phase:** 6 (v1.0 SDK) [CONFIDENCE: med]

### Isolation Model

The embed SDK renders the editor inside an `<iframe>`. The embedding page communicates with the editor only through `postMessage` / `AtlasdrawAPI`. The API surface is:
- `async` methods only (no sync DOM access)
- JSON-serializable arguments and return values
- Structurally tested with a round-trip clone test

The embedding page cannot access the editor's DOM directly. The editor cannot access the embedding page's DOM.

### Attribution Un-removability

The embed iframe contains a non-removable OSM attribution overlay rendered as a DOM element inside the iframe. Per Q6 resolution, OSM attribution must be visible in embeds. The overlay is:
- Inside the iframe (inaccessible to the embedding page)
- Positioned by the editor application (not by CSS in the host page)
- Required for OSM license compliance

### CSP Profile for Embeds

Embed consumers who set `Content-Security-Policy: frame-src` must include the Atlasdraw embed origin. The embed SDK documentation provides the required `frame-src` directive.

---

## Stripe Webhook Signing (Phase 6 Hosted Mode)

**Mechanism:** Standard `Stripe-Signature` HMAC header verification
**Phase:** 6 (hosted multi-tenant mode) [CONFIDENCE: med — from Phase 6 file structure]

Stripe webhook events (`checkout.session.completed`, subscription updates) are verified using the `Stripe-Signature` HMAC header before processing. The webhook secret is an environment variable; it is never logged or returned in API responses. The handler in `apps/realtime/src/stripe-webhooks.ts` rejects any webhook without a valid signature with 400.

---

## OIDC (Hosted Mode, Phase 6)

**Mechanism:** OIDC provider integration for hosted multi-tenant auth
**Phase:** 6 (hosted mode, optional) [CONFIDENCE: low — Phase 6 mentions "OIDC optional" without full spec]

When `MANAGED_MODE=true`, the hosted flagship supports OIDC provider integration for SSO. Self-hosted deployments have no authentication requirement in v1.0 (single-tenant, local access assumed). The workspace isolation middleware in `apps/realtime/src/workspace-middleware.ts` enforces per-workspace room isolation when multi-tenant mode is active.

---

## Telemetry Policy (ADR 0006)

**Mechanism:** Zero default; opt-in only; no PII
**Phase:** 6 (ADR written in Phase 6 Wave 0) [CONFIDENCE: high — from Phase 6 Task 4]

| Context | Default | What is sent |
|---|---|---|
| OSS self-hosted | Zero telemetry | Nothing |
| Hosted flagship | Opt-in only | `map_created`, `layer_added`, `embed_loaded` (no PII) |
| Anonymous heartbeat | Opt-in at install | `{instance_id, version, maps_created_this_week}` |
| Embed SDK (`packages/sdk`) | Zero, always | Nothing — SDK never makes network calls |

The SDK's zero-telemetry commitment is a hard contract: `packages/sdk` must not make any network calls outside the `postMessage` bridge to the host editor. This is enforced by the adversarial test suite in Phase 6 Task 23 ("CI telemetry guard").

Every release is reviewed for unwanted call-home behavior. The telemetry guard CI step fails if any new network call is detected in the SDK bundle.
