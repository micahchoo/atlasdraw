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
| basemap registry | extensible plugin seam per `docs/PHASES.md` Phase 7 (v1.5) — Plugin SDK naming `registerLayerType` | static 4-entry array (`protomaps-light/dark`, `openfreemap-bright`, `osm-standard`), `getBasemap(id)` lookup only — confirmed via grep, no "register" keyword anywhere in the file | `packages/basemap/src/BasemapRegistry.ts:49` | designed-latent — Phase 7 roadmap already names this seam; today's shape is the pre-plugin baseline | **pursue** | spec interview below |
| tools registry | same Phase 7 Plugin SDK, naming `registerTool` | 11 individually-exported tool objects (`PinTool`, `PolygonTool`, ... — confirmed via grep), no registry array or lookup table at all | `packages/tools/src/index.ts` | designed-latent — same Phase 7 roadmap | **pursue** | spec interview below (same brief — one Plugin SDK spans both) |

### Commissioned spec interview (Direction 4)

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
premise, nothing to build); Direction 4 pursued with a shared spec-interview
brief, commissioned not built; Direction 5 rejected and actually executed —
the redundant tier is gone, not just decided against.
