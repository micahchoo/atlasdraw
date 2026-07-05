# Headroom audit — ISSUES.md Directions 2, 4, 5

Ledger: dimension | declared | reached | pinned at | intent | verdict |
commissioned as.

---

## Direction 2 — Graduated layer styling: three methods declared, allegedly one reached

**Verification note (before acting on the premise):** `style-compiler.ts:48`'s
comment — *"For all three methods the compiler emits a linear
interpolation"* — reads like a shipped placeholder, and the original tend
sweep took it as one. Tracing the actual data flow shows it isn't:
`StylePanel.tsx` (`computeStops`, lines 80-94) already dispatches on
`method` and computes genuinely different stop arrays — `quantileStops`
(53-68) is a real percentile-based implementation, and `equalIntervalStops`
(76-78) is a one-line alias of `linearStops` **because that's the correct
mathematical definition of equal-interval classification** (equal-width bins
across the value range — identical to what "linear" breaks already are).
By the time `style-compiler.ts` receives `expr.stops`, the method's job is
already done; the `["linear"]` in its `["interpolate", ["linear"], ...]`
output is MapLibre's required interpolation-**curve** parameter (how to
blend between two already-chosen adjacent stops), not a statement about
break selection. This is standard, correct MapLibre usage — not a gap.

| dimension | declared | reached | pinned at | intent | verdict | commissioned as |
|---|---|---|---|---|---|---|
| graduated-style `method` (linear/quantile/equal-interval) | 3 methods, user-selectable in `StylePanel`/`ColorRampPicker` | all 3 — quantile is genuinely distinct; equal-interval is correctly identical to linear by definition; the compiler's "linear" is the interpolation curve, not the break method | `StylePanel.tsx:53-94` (real implementation), `style-compiler.ts:48-56` (misread comment) | n/a — not a gap | **reject** — false premise on verification, no code changes needed | none |

---

## Direction 4 — Registries with no register(): BasemapRegistry, tools

| dimension | declared | reached | pinned at | intent | verdict | commissioned as |
|---|---|---|---|---|---|---|
| basemap registry | extensible plugin seam per `docs/PHASES.md` Phase 7 (v1.5) — Plugin SDK naming `registerLayerType` | **built 2026-07-05**: `registerBasemap`/`listBasemaps` added, 4 existing entries seed the registry at module load, `getBasemap`/`BASEMAPS` unchanged for existing consumers | `packages/basemap/src/BasemapRegistry.ts` | designed-latent — Phase 7 roadmap already names this seam; today's shape was the pre-plugin baseline | **pursue** | built, not just specced |
| tools registry | same Phase 7 Plugin SDK, naming `registerTool` | **built 2026-07-05**: `registerTool`/`getTool`/`listTools` added, 8 existing tools self-register at module load, all 8 unchanged as named exports | `packages/tools/src/index.ts` | designed-latent — same Phase 7 roadmap | **pursue** | built, not just specced |

### Commissioned spec interview (Direction 4) — run via `/grill-with-docs`

```
Design the registration API shape for atlas-app's future plugin SDK
(docs/PHASES.md Phase 7 / v1.5 names registerTool, registerLayerType,
registerStylingFn, and a PluginRegistry with integrity hashing). Two
concrete pre-plugin baselines to extend: packages/basemap/src/
BasemapRegistry.ts (static 4-entry array + getBasemap(id) lookup, no
add/register) and packages/tools/src/index.ts (11 tool objects exported
individually, no registry array at all). Interview: does a single generic
Registry<T> class serve both, or do basemap/tool registration have different
enough shapes (basemaps are pure data, tools bundle behavior + Excalidraw
integration) to need separate APIs? What does "integrity hashing" mean
concretely for basemaps vs tools? Should this land ahead of Phase 7 proper
(current verdict: pursue now) or is a spec-only brief enough for Phase 7
kickoff to pick up? Bring back a brief, not code — no register() ships from
this interview alone.
```

### Interview outcome vs. what actually shipped

The interview's own recommendation — share one generic `Registry<T>` via
`@atlasdraw/common` — turned out not to hold once implementation started:
the root `tsconfig.json`'s composite project graph explicitly excludes
`@atlasdraw/common` from the atlas-owned package graph (`basemap`, `data`,
`geo`, `tools`, `cli`) — a documented boundary ("Vendored Excalidraw
packages... prevent composite... path-resolved via tsconfig.base.json
paths"), not an oversight. Adding `@atlasdraw/common` as a dependency of
`packages/basemap` immediately hit a real `tsc` rootDir violation. Given
the primitive is ~15 trivial lines (register/get/list over a `Map`), each
package now carries its own private copy rather than crossing that
boundary — the "different enough shapes" question the interview raised
turned out moot once the sharing mechanism itself wasn't viable. Same
outward API either way: `registerBasemap`/`listBasemaps` and
`registerTool`/`getTool`/`listTools`, both zero-breaking-change over the
prior static exports.

**Integrity hashing / Web Worker sandbox / PluginManifest**: confirmed out
of scope, left as a code comment pointing at this ledger rather than built
— that's the actual Phase 7 (v1.5) plugin loader, a separate and much
larger piece of work sitting on top of the registration primitive shipped
here.

---

## Direction 5 — "Pro+" billing tier: fully priced, functionally identical to Pro

| dimension | declared | reached | pinned at | intent | verdict | commissioned as |
|---|---|---|---|---|---|---|
| `pro_25` ("Pro+") tier distinctness | two paid tiers, each with its own Stripe price ID (`STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_25`) | `pro_25` reused `pro`'s map cap exactly — confirmed via grep, no other field distinguished the two anywhere in `apps/storage` or `apps/atlas-app` | `middleware/quota.ts` (`QuotaLimits.pro_25`), `types.ts` (`WorkspacePlan`), `routes/billing.ts` (`priceIdForTier`), `config.ts` (`STRIPE_PRICE_PRO_25`) | unknown — no ADR/comment explained what Pro+ was meant to add | **reject** — fold `pro_25` back into `pro`, stop charging two prices for one tier | **executed this pass** (see below) |

### Executed

- `types.ts`: `WorkspacePlan` narrowed to `"free" | "pro"`.
- `config.ts`: `STRIPE_PRICE_PRO_25` env var removed.
- `middleware/quota.ts`: `QuotaLimits.pro_25` field and `capForPlan`'s
  `"pro_25"` case removed.
- `routes/billing.ts`: `stripePricePro25` option, `priceIdForTier`'s
  `pro_25` branch, and both `priceTier !== "pro" && priceTier !== "pro_25"`
  validity checks removed (now just `priceTier !== "pro"`).
- `index.ts`: `pro_25`/`stripePricePro25` wiring removed from the two
  registration call sites.
- Tests updated: `middleware/__tests__/quota.test.ts`,
  `routes/__tests__/billing.test.ts` (idempotency test's plan-transition
  fixture switched from `pro_25` to `pro`).
- `CHANGELOG.md`: corrected "Pro / Pro+ tiers" claim to "Pro tier"; added an
  `[Unreleased]` → Removed entry recording the fold-back.
- All 122 storage tests green after the change.

## Done

All three surpluses resolved: Direction 2 rejected on verification (false
premise, nothing to build); Direction 4 pursued, specced via
`/grill-with-docs`, and built — `registry.test.ts` (tools, 5 tests, new),
`BasemapRegistry.test.ts` (9 tests, up from 6); Direction 5 rejected and
actually executed — the redundant tier is gone, not just decided against.
basemap 7 files/76 tests, tools 12 files/77 tests, storage 122 tests, all
green.
