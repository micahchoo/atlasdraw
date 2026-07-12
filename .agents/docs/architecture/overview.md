# Atlasdraw — Architecture Overview

**Status: Speculative.** This document predicts the architecture as it will exist after Phase 7
ships. It will be updated against real code starting Phase 0.

---

## TL;DR

Atlasdraw is a geo-drawing editor — Excalidraw's freehand annotation layer superimposed on a
MapLibre GL basemap. It is a Yarn-workspace monorepo forked from the Excalidraw repository
(spec §1). The product trick is: MapLibre owns the camera (WGS84 / Mercator), and Excalidraw's
scroll/zoom state is a derived mirror of it (spec §0).

After Phase 7, the repo contains 8 workspace packages, 3 apps, a shared infra directory, and a
decisions ADR corpus — roughly 11 logical subsystems.

---

## Monorepo Layout

```
atlasdraw/
├── packages/
│   ├── excalidraw/        # vendored upstream — light patches only (Q6)
│   ├── element/           # vendored upstream — no patches
│   ├── math/              # vendored upstream — no patches
│   ├── common/            # vendored upstream — no patches
│   ├── geo/               # coord transforms, GeoJSON adapters, projections
│   ├── basemap/           # MapLibre wrapper, style management, basemap registry
│   ├── data/              # file format readers/writers + geocoding + importers
│   ├── tools/             # geo-aware drawing tools (pin, route-snap, polygon, measure)
│   ├── sdk/               # embed widget — lean, MIT-licensed (Q5)
│   ├── cli/               # headless tooling — lint, convert, render (Q5)
│   └── plugin-host/       # plugin worker sandbox + PluginRegistry (Phase 7)
├── apps/
│   ├── atlas-app/         # editor SPA (replaces excalidraw-app)
│   ├── realtime/          # WebSocket relay — Socket.IO + y-websocket (Phase 5)
│   └── storage/           # Fastify HTTP server — map metadata + blob API (Phase 4)
├── infra/
│   ├── docker-compose.yml             # 5-service full stack
│   ├── docker-compose.minimal.yml     # 3-service try-it stack (Q10)
│   └── caddy/Caddyfile
├── docs/
│   ├── architecture/      # this directory
│   ├── decisions/         # ADRs 0001–0009+
│   └── superpowers/plans/ # per-phase implementation plans
└── decisions/             # repo-root ADR symlink or duplicate (spec §1)
```

(spec §1; plan-0 Task 1; plan-7 Feature 2)

---

## 11 Subsystems

| # | Name | One-line responsibility |
|---|------|------------------------|
| 1 | `packages/geo` | Coordinate transforms, GeoJSON adapters, projection utilities |
| 2 | `packages/basemap` | MapLibre GL wrapper, style registry, PMTiles serving |
| 3 | `packages/data` | File format I/O (.atlasdraw ZIP, GeoJSON, KML, SHP, CSV), geocoding, importers |
| 4 | `packages/tools` | Geo-aware Excalidraw custom tools (pin, route-snap, polygon, measure) |
| 5 | `packages/sdk` | Embed widget surface — postMessage API, MIT license |
| 6 | `packages/cli` | Headless lint / convert / render — MIT license |
| 7 | `packages/excalidraw` | Vendored Excalidraw fork — scene, elements, renderer |
| 8 | `apps/atlas-app` | Editor SPA — React, Zustand, MapLibre + Excalidraw composition |
| 9 | `apps/realtime` | WebSocket relay — Socket.IO presence + y-websocket CRDT endpoint |
| 10 | `apps/storage` | REST API — map CRUD, share tokens, blob storage (Fastify + Postgres + MinIO/S3) |
| 11 | `decisions/` | ADR corpus — architectural decisions, escalations, open-questions resolutions |

Detailed boundaries and contracts: see `subsystems.md`.

---

## Top 3 Architectural Risks

1. **Coordinate sync drift** — MapLibre and Excalidraw must stay sub-pixel-aligned during
   pan/zoom. Any scroll/zoom event handler that skips re-projection causes visible misalignment.
   The `GeoAnchor` type has already drifted across three phase plans (MISMATCH-1, -3, -5 in
   cross-phase audit). See `risk-map.md § technical`.

2. **Excalidraw fork churn** — Monthly upstream merges (Q6) will produce cumulative patch
   conflicts. The hard-exit threshold (two consecutive quarters of broken patches or `customData`
   field removal) is a known trip-wire. See `risk-map.md § technical`.

3. **Yjs E2EE boundary** — E-01 escalation is unresolved. The `yjs-crypto.ts` stub ships in
   Phase 5 but wiring is deferred. The threat model difference between "server-trusted relay"
   and "true E2EE" is a security property question with legal and product implications.
   See `risk-map.md § security`.

---

## Confidence by Zoom Level

| Zoom level | Confidence | Basis |
|------------|------------|-------|
| Top-level repo layout | High | Directly specified in spec §1 and plan-0 |
| Subsystem names and responsibilities | High | Explicit in spec §4 and each phase plan |
| Inter-subsystem contracts (types, events) | Medium | Specified, but three known mismatches exist |
| Behavioral detail (render loop, CRDT merge) | Low | Outlined but subject to engineering judgment |
| Phase 7 features (plugin API, QGIS bridge) | Low | Planned but not yet designed at component level |

---

## Cross-references

- Subsystem boundaries and contracts: `subsystems.md`
- External systems and dependencies: `ecosystem.md`
- Runtime deployment: `infrastructure.md`
- Architectural risks: `risk-map.md`
- Phase timeline and evolution: `evolution.md`
- Business domain and personas: `domain.md`
