# Atlasdraw Licensing

This project ships under three open-source licenses. The split balances protecting against SaaS-reseller capture (AGPL on the running app) with maximum reuse of the file-format and geometry libraries (MIT).

## Per-package licenses

| Package | License | Reason |
| --- | --- | --- |
| `apps/atlas-app` | AGPL-3.0 | Running editor — copyleft prevents closed-source SaaS resale |
| `apps/realtime` | AGPL-3.0 | Server component — same reason |
| `apps/storage` | AGPL-3.0 | Server component — same reason |
| `packages/cli` | MIT | Headless tooling — must run in any pipeline |
| `packages/geo` | MIT | Pure math/types — maximum reuse |
| `packages/data` | MIT | File format I/O — maximum reuse, ecosystem leverage |
| `packages/protocol` | MIT | Room-link and comment types — maximum reuse |
| `packages/basemap` | MPL-2.0 | MapLibre wrapper — file-level copyleft, library-friendly |
| `packages/tools` | MPL-2.0 | Drawing tools — file-level copyleft |
| `packages/excalidraw` (vendored) | MIT | Upstream Excalidraw remains MIT |
| `packages/element` (vendored) | MIT | Upstream — MIT |
| `packages/math` (vendored) | MIT | Upstream — MIT |
| `packages/common` (vendored) | MIT | Upstream — MIT |
| `packages/utils` (vendored) | MIT | Upstream — MIT |

## Worked examples

### Embedding the iframe in your closed-source SaaS dashboard

**Permitted.** An `<iframe>` that points at the `/embed` route of an Atlasdraw deployment does not put Atlasdraw code into your app, so it does not change your app's license. If you modify Atlasdraw and host the result, the next example applies. There is no embed SDK package (ADR-0016).

### Modifying `apps/atlas-app` and hosting your fork as a public SaaS

**You must open-source your modifications.** AGPL-3.0 §13 obligates network-served modified versions to make their source available to users. This is the deliberate moat against hyperscaler resale.

### Reading and writing `.atlasdraw` files from your closed-source GIS pipeline

**Permitted.** `packages/cli` and `packages/data` are MIT. The file format is open. You can build a closed-source converter that produces `.atlasdraw` for ingestion into Atlasdraw, with no obligation to share source.

### Forking `packages/basemap` and shipping a closed-source modified MapLibre wrapper

**Mixed.** MPL-2.0 is file-level copyleft: any file you modify must remain MPL-2.0 (its source disclosed). New files you add can be any license, including proprietary. Combined work can be distributed under your terms as long as the modified MPL files remain accessible.

### Building a desktop Electron wrapper around `apps/atlas-app`

**Triggers AGPL.** Even though Electron is local-only execution, AGPL §13 reaches "remote network interaction" — and any auto-updater pinging your server counts.

## Contributing

By submitting a contribution to this repository, you agree your changes are licensed under the same license as the file you modify. There is no separate CLA — the per-file SPDX header is the contract.

## Why three licenses instead of one?

Single-AGPL would deter MIT-licensed projects from depending on our libraries or CLI (license incompatibility on linking). Single-MIT would let any cloud provider resell our editor as a managed service contributing nothing back. The split is deliberate and load-bearing.

## Enforcement

Every `package.json` must declare `"license"` with the value in the table above. `bash scripts/check-license.sh` fails if a package has no `license` field or a wrong one. CI does not run it yet, and it does not list `apps/storage` or `packages/protocol`; run it by hand after you add a package.

## Questions

If this LICENSING.md doesn't answer your question, open a discussion at the project repo. We will not silently relicense anything; license changes require an ADR (`decisions/`).
