# `packages/cli` — Modules

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT
**Package name:** `@atlasdraw/cli`

---

## Internal Module Dependency Graph

```
packages/cli/
├── bin/atlasdraw.ts            ← CLI entry; routes to commands
│   └── deps: commands/*
│
├── commands/
│   ├── lint.ts                 ← deps: packages/data (atlasdraw.parse)
│   │                              ext: packages/geo (GeoAnchor for validation)
│   │
│   ├── convert.ts              ← deps: packages/data (all format modules)
│   │
│   └── render.ts               ← deps: packages/data (atlasdraw.parse, pre-validate)
│                                  ext: puppeteer (optional peer)
│
└── index.ts                    ← programmatic API barrel
    └── deps: commands/lint, commands/convert, commands/render
```

---

## ASCII Layering

```
┌────────────────────────────────────────────┐
│             bin/atlasdraw.ts               │
│           (CLI argument routing)           │
└──────┬──────────────┬──────────────────────┘
       │              │
       ▼              ▼
  lint.ts          convert.ts       render.ts
       │              │                │
       └──────┬────────┘                │
              ▼                         │
         packages/data             puppeteer
         (parse/write)            (optional)
              │
              ▼
         packages/geo
         (GeoAnchor, projection)
```

---

## Layering Rules

1. **Node.js only.** `packages/cli` may use `fs`, `path`, `process`, `Buffer`, and Node built-ins freely. No browser APIs.
2. **No React, no DOM.** The `render` command drives a browser via Puppeteer — it does not import React itself.
3. **`render.ts` is the only file that touches Puppeteer.** All other commands are pure Node. This ensures `lint` and `convert` remain lightweight and testable without a browser.
4. **Puppeteer is an optional peer dependency.** `render.ts` `require()`s Puppeteer lazily with a `try/catch`. If not installed, the `render` command prints a helpful install message and exits with code 1.
5. **No imports from `apps/*`, `packages/basemap`, `packages/tools`, or `packages/sdk`.** The CLI uses only the MIT-licensed data and geo packages.

---

## Knot Complement — Independent Refactor Units

| Module | Can refactor independently? | Notes |
|--------|------------------------------|-------|
| `commands/lint.ts` | Yes | Only uses `packages/data` and `packages/geo` interfaces |
| `commands/convert.ts` | Yes | Format routing table; swap format modules freely |
| `commands/render.ts` | Yes | Puppeteer coupling isolated here; can be replaced with playwright or another headless browser |
| `bin/atlasdraw.ts` | Yes | Argument parsing; can swap `commander` for `yargs` without changing commands |

---

## External Dependencies

| Dep | Usage | Notes |
|-----|-------|-------|
| `commander` or `yargs` | Arg parsing in `bin/atlasdraw.ts` | Choice is engineering judgment; not specified in spec |
| `puppeteer` | `commands/render.ts` only | Optional peer dep — not bundled by default |
| `packages/data` | `lint`, `convert`, `render` | MIT; always included |
| `packages/geo` | `lint` (GeoAnchor validation), `render` (headless projection) | MIT; always included |

---

## Package Boundary

`packages/cli` must not import from:
- `apps/*` (AGPL — would contaminate MIT; also not available in a Node context without a build step)
- `packages/basemap` (MPL-2.0; also requires a browser DOM)
- `packages/tools` (MPL-2.0; DOM-event-based)
- `packages/sdk` (circular — sdk is a downstream consumer)
