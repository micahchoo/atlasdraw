# `packages/sdk` — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT
**Package name:** `@atlasdraw/sdk`

---

## Internal Module Dependency Graph

```
packages/sdk/
├── src/index.ts                ← barrel export (AtlasdrawEmbed, mount, unmount, types)
│
├── src/api-types.ts            ← pure type declarations; NO runtime deps
│
├── src/embed-bridge.ts         ← message protocol constants; NO external deps
│   └── (shared by host-side api.ts and iframe-side embed-renderer.ts)
│
├── src/api.ts                  ← host-side API implementation
│   ├── deps: api-types.ts, embed-bridge.ts
│   └── ext: (none — operates on window.postMessage)
│
├── src/AtlasdrawEmbed.tsx      ← React component
│   ├── deps: api.ts, api-types.ts, embed-bridge.ts
│   └── ext: react
│
├── src/mount.ts                ← vanilla mount/unmount
│   ├── deps: api.ts, embed-bridge.ts
│   └── ext: (none)
│
└── src/embed-renderer.ts       ← runs in the iframe; loaded by the editor's HTML
    ├── deps: embed-bridge.ts
    └── ext: apps/atlas-app editor API (runtime, not import)
```

---

## ASCII Layering

```
Host page (consumer)
│
├── React path:
│     <AtlasdrawEmbed src="..." onReady={fn} />
│           │
│           └── AtlasdrawEmbed.tsx
│                   │
│                   └── api.ts ──── embed-bridge.ts ──┐
│                                                      │ postMessage
│                                                ┌─────┘
│                                                │
└── Vanilla path:                                ▼
      mount(container, opts)         embed-renderer.ts (in iframe)
           │                               │
           └── api.ts ── embed-bridge.ts   └── editor AtlasdrawAPI
                                               (apps/atlas-app runtime)
```

---

## Layering Rules

1. **`embed-bridge.ts` is the only file shared between host and iframe.** It must have zero external dependencies. It defines only message protocol constants and types.
2. **`api-types.ts` is type-only.** No runtime logic. Safe to import in any context (Node, browser, worker).
3. **`AtlasdrawEmbed.tsx` is the only React-touching file.** `mount.ts` is React-free — it can be used in Vue, Angular, or plain HTML contexts.
4. **`api.ts` must not import any Atlasdraw editor code.** It only knows about the message protocol defined in `embed-bridge.ts`. The editor is a black box behind an iframe boundary.
5. **`embed-renderer.ts` is bundled into the iframe page, not into the SDK package.** It is built as part of the `apps/atlas-app` build, not the `@atlasdraw/sdk` package. It is listed here for architectural clarity only.
6. **No AGPL code in the SDK bundle.** The MIT/AGPL boundary is enforced at the iframe boundary — confirmed by the license CI check (`scripts/check-license.sh`).

---

## Knot Complement — Independent Refactor Units

| Module | Can refactor independently? | Notes |
|--------|------------------------------|-------|
| `embed-bridge.ts` | No — shared protocol | Changing message protocol requires coordinated update of api.ts and embed-renderer.ts |
| `api-types.ts` | No — frozen API | Stable from Phase 6; changes require major version |
| `api.ts` | Partially | Can refactor internals (correlation ID impl, timeout); interface is frozen |
| `AtlasdrawEmbed.tsx` | Yes | Rendering logic only; depends on api.ts interface |
| `mount.ts` | Yes | Vanilla wrapper; depends on api.ts interface |

---

## External Dependencies

| Dep | Usage | Notes |
|-----|-------|-------|
| `react` | `AtlasdrawEmbed.tsx` only | peerDep; not bundled |

No other external runtime dependencies. `packages/sdk` is intentionally lean — the embed widget must be minimally sized for consumer CDN use.

---

## Build Output

The SDK ships two build targets:
- `dist/index.js` — ESM bundle for `import` in modern apps
- `dist/index.umd.js` — UMD bundle for `<script>` tag usage
- `dist/index.d.ts` — TypeScript declarations

`AtlasdrawEmbed.tsx` is excluded from the UMD build (React required). `mount.ts` and `api.ts` are included in all targets.
[CONFIDENCE: med — build targets extrapolated from typical MIT embed SDK patterns]

---

## Package Boundary

`packages/sdk` must not import from:
- `apps/*` (AGPL — would contaminate the MIT package)
- `packages/basemap` (MPL-2.0 — would contaminate MIT)
- `packages/tools` (MPL-2.0 — would contaminate MIT)

It may import from (all MIT):
- `packages/geo` (for `GeoAnchor` type alignment in `SerializedGeoAnchor`)
- `packages/data` (for `AtlasdrawFile` type in `exportAtlasdraw` return type)
