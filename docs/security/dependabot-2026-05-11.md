# Dependabot triage — 2026-05-11 (post-Phase 4)

25 open alerts. Triaged into three buckets: actionable, non-applicable, and tolerated.

## Actionable (1)

| # | Pkg | Sev | Manifest | GHSA | Action |
|---|---|---|---|---|---|
| 242 | `@babel/plugin-transform-modules-systemjs` | high | `code/yarn.lock` | [GHSA-fv7c-fp4j-7gwp](https://github.com/advisories/GHSA-fv7c-fp4j-7gwp) | Pinned `^7.25.9` (resolves to 7.25.9). Patched in 7.26.x. Upgrade transitive Babel deps via `yarn upgrade @babel/core`. Build-time only; no runtime exposure. |

Rationale: babel transforms run at build time. CVE is "arbitrary code in compiled output," not in the babel process. The compiled output is our own application code; we control all inputs. Low real-world severity for our usage, but trivial to upgrade.

## Non-applicable (5) — vendored production-path code at safe versions or not exposed

| # | Pkg | Sev | Manifest | Why not applicable |
|---|---|---|---|---|
| 244 | `vitest` 3.0.6 | critical | `code/apps/storage` | RCE [GHSA-9crc-q9x8-hgqq](https://github.com/advisories/GHSA-9crc-q9x8-hgqq) fires **only** when Vitest API server is listening (`vitest --api`). Our config does not enable the API server. Dev-only dep; not shipped in image. |
| 243 | `vitest` 3.0.6 | critical | `code/packages/data` | Same. Dev-only. |
| 240 | `fast-uri` 3.0.6/3.1.2 | high | `code/yarn.lock` | [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc) patched in ≥3.0.6. Both lock entries are at or above the fix line. GH may need re-evaluation. |
| 239 | `fast-uri` 3.0.6/3.1.2 | high | `code/yarn.lock` | [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6) — same. Already patched. |
| 241 | `@babel/plugin-transform-modules-systemjs` | high | `code/dev-docs/yarn.lock` | dev-docs is the vendored Excalidraw documentation site, not deployed by us. No runtime exposure. |

Action: re-run Dependabot scan after a `yarn dedupe` (Yarn v4) or `yarn-deduplicate` (v1) pass to consolidate fast-uri to a single 3.1.2 entry; GH should clear 239/240 automatically.

## Tolerated (19) — `code/dev-docs/` and `code/examples/with-nextjs/` vendored surface

All medium and low severity. All in `code/dev-docs/yarn.lock` (the Excalidraw vendored docs site we do not deploy) or `code/examples/with-nextjs/yarn.lock` (vendored example, not deployed). Packages: `dompurify` (×9), `nanoid` (×5 transitive), `qs` (×2), `prismjs`.

Action: none in Phase 4 scope. If Phase 6 ever ships dev-docs as a public surface, retriage these. Until then, vendored vulnerable code that does not execute against attacker input is acceptable.

## Decision

- Do **not** dismiss alerts in the GitHub UI in this session (shared-system action; needs explicit operator authorization).
- Schedule `yarn upgrade @babel/core` + `yarn-deduplicate` as a Phase 5 warm-up task.
- Phase 4 shippable surface (storage server, atlas-app, infra) has **zero high or critical alerts that apply at runtime**.

## Verification

```bash
# Re-enumerate after any change
gh api 'repos/micahchoo/atlasdraw/dependabot/alerts?state=open&per_page=100' \
  --jq '[.[] | {n,sev:.security_advisory.severity,pkg:.dependency.package.name,manifest:.dependency.manifest_path}]'

# Confirm no --api in test runner
grep -rn 'vitest.*--api\|api: *true' code/apps code/packages
```
