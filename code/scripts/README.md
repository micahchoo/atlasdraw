# scripts/

CI and developer scripts for Atlasdraw. All scripts run from the repo root.

## check-license.sh

Validates that every workspace `package.json` declares the correct `"license"` field per ADR 0002 (license split). Run on every PR and push to `main`.

Expected values:

- Root + `apps/*`: `AGPL-3.0-only`
- `packages/sdk`, `packages/cli`, `packages/geo`, `packages/data`, vendored packages: `MIT`
- `packages/basemap`, `packages/tools`: `MPL-2.0`

Exits 1 and prints `FAIL: <path> license=<actual> expected=<expected>` on any mismatch.

## check-telemetry.sh

Scans `apps/atlas-app/src/`, `apps/realtime/src/`, and `packages/sdk/src/` for forbidden telemetry imports (`@sentry/`, `firebase`, `mixpanel`, `amplitude`, `google-analytics`, `posthog`) per ADR 0006. The embed SDK and user-facing apps must never call home.

Lines annotated with `// telemetry-allowed: opt-in (ADR 0006)` are exempt (intended for `apps/storage` only, which is not in the scan paths).

## When CI runs these

Nothing runs `check-license.sh` or `check-telemetry.sh` today. The `atlasdraw-checks` workflow that ran them lived in `code/.github/`, which GitHub never executes, and that directory is gone. The root `.github/workflows/ci.yml` runs `find-unfalsifiable-tests.mjs` through `yarn test:falsifiable`.
