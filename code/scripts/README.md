# scripts/

CI and developer scripts for Atlasdraw. All scripts run from the repo root.

## check-license.sh

Validates that every workspace `package.json` declares the correct `"license"` field per ADR 0002 (license split). Run on every PR and push to `main`.

Expected values:

- Root + `apps/*`: `AGPL-3.0-only`
- `packages/cli`, `packages/geo`, `packages/data`, vendored packages: `MIT`
- `packages/basemap`, `packages/tools`: `MPL-2.0`

Exits 1 and prints `FAIL: <path> license=<actual> expected=<expected>` on any mismatch.

## check-telemetry.sh

Scans `apps/atlas-app/src/` and `apps/realtime/src/` for forbidden telemetry imports (`@sentry/`, `firebase`, `mixpanel`, `amplitude`, `google-analytics`, `posthog`) per ADR 0006. The user-facing apps must never call home.

Lines annotated with `// telemetry-allowed: opt-in (ADR 0006)` are exempt (intended for `apps/storage` only, which is not in the scan paths).

## When CI runs these

The `check` job of `.github/workflows/ci.yml` runs `check-license.sh`, `check-telemetry.sh` and `find-unfalsifiable-tests.mjs` (through `yarn test:falsifiable`) on every pull request and every push to `main`.
