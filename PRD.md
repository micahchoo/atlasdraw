# Atlasdraw — Product Requirements Document

*An open-source, self-hostable collaborative web map studio, built on Excalidraw + MapLibre*

**Status:** Draft v0.1 — for circulation to founding contributors, design partners, and early users
**Working name:** *Atlasdraw* (alternatives: Cartograph, Plotpaper, Open Felt, Foliomap — see §13)
**License intent:** AGPL-3.0 for the application, MIT/BSD-3 for client SDK and importable libraries
**Target audience for this PRD:** founding maintainers, day-1 contributors, design partners, and OSS funders

---

## TL;DR

- **What we're building:** A free, self-hostable, real-time collaborative map studio that combines Excalidraw's drawing/whiteboard infrastructure with MapLibre GL JS as the basemap, optimized for the prosumer mapmaker — the data journalist, urban planner, community organizer, real-estate analyst, indie researcher, and outdoor enthusiast — who lost access (or was priced out) when Felt pivoted to enterprise GIS in 2024–2025.
- **Why now:** Felt's January 2025 plan migration moved its core capabilities (Upload Anything, Felt Layers, AI extensions, SDK) behind Team ($200/mo) and Enterprise gates; the free tier no longer permits data uploads or hand-drawn-to-layer conversion. The mapping middle market — too sophisticated for Google My Maps, too casual for QGIS, too resource-poor for ArcGIS Online — is again unserved, while the open-geo stack (MapLibre, Protomaps PMTiles, OpenFreeMap, Tippecanoe, Photon/Pelias, Turf.js) has matured to the point where a credible Felt-class product can be assembled with modest engineering.
- **The bet:** A "geospatial Figma" already exists culturally; what's missing is a "geospatial Excalidraw + Obsidian" — opinionated, locally-runnable, file-portable, MIT/AGPL-clean, and good enough for 80% of jobs-to-be-done without a credit card. We win by being radically simple to install (single Docker command), file-format-portable (`.atlasdraw` is just JSON + GeoJSON + a manifest), and embeddable on any static site.

---

## 1. Vision

A map should be as easy to draft, share, and embed as a Google Doc — and as portable as a Markdown file. Atlasdraw is the open, self-hostable canvas for collaborative cartography. It treats the map as a *document*: a single shareable artifact combining a basemap, structured geographic data, freeform annotations, and a presentation layer, that can be exported, version-controlled, and run on a laptop in airplane mode.

We are not building a GIS. We are building the **mapping equivalent of Excalidraw + Notion + Figma's commenting layer**, sitting one layer above the open-geo stack. Where QGIS optimizes for analytical depth and ArcGIS for institutional integration, Atlasdraw optimizes for the *speed from idea to shared map*. Most of our users will spend less than thirty minutes per map; their measure of success is whether a colleague, editor, councillor, or reader understood the point.

---

## 2. Problem Statement

For roughly four years (2021–2025), Felt occupied a unique position: a polished, browser-first, real-time-collaborative map editor with a free tier generous enough to support data journalism, classroom use, neighborhood organizing, and indie research. In January 2025, Felt completed its migration to a Team/Enterprise plan structure (announced mid-2024), removing data upload, Felt Layers, and AI tooling from the free tier and re-positioning the company around AI-native enterprise GIS — reinforced by a $15M Series A extension led by Energize Capital aimed explicitly at "transforming enterprise GIS." Watermarked grey tiles now obscure paid-feature maps when subscriptions lapse.

The community response has been familiar: praise for what Felt was, frustration at the loss of the consumer-accessible tier, and a search for alternatives. The serious commercial replacement, **Atlas.co**, is well-built but is itself a closed-source SaaS with seat-based pricing, repeating the same trap one rung down. The open-source alternatives each solve part of the problem but none solve all of it:

- **uMap** (AGPL, Django/Leaflet) is the closest in spirit but feels dated, lacks real-time collaboration in the released version, and has limited drawing/annotation expressiveness.
- **Kepler.gl** (MIT) is exceptional for large-scale visualization but is configuration-heavy, not collaborative, and not designed for sketch/annotate/share.
- **QGIS** (GPL) is the desktop powerhouse but is exactly the tool the prosumer is trying to avoid.
- **Maputnik** (MIT) is a basemap *style* editor, not a map *document* editor.
- **Mapeo** (Digital Democracy) is offline-first peer-to-peer for indigenous land defense — a brilliant but narrow product shape.
- **Datawrapper** does choropleths beautifully but isn't a freeform map canvas.

The gap is therefore concrete and definable: **a permissively-licensed, self-hostable, real-time-collaborative map document editor with great drawing tools, painless data import, and one-click sharing/embed.** That is the Felt-shaped hole, and it is what Atlasdraw fills.

---

## 3. Target Users and Personas

We are explicitly building for the **prosumer mapmaker** — the user with a real spatial problem, modest data, and no GIS budget. Four personas anchor our prioritization.

**Persona A: Priya, the data journalist.** Reports for a regional newsroom. Cobbles together QGIS for processing, Datawrapper for choropleths, and (until 2025) Felt for narrative annotation and embeds. She ships 2–4 map-based stories a month. Her JTBDs: import a CSV of incidents and get them on a styled basemap in under five minutes; sketch arrows, callouts, and explanatory text on top; share a draft link with her editor; embed the final map as a responsive iframe in her CMS. Pain points: Mapbox and ArcGIS billing surprises, Datawrapper's rigid map types, the "screenshot of QGIS" anti-pattern. She is willing to pay $5–15/mo for hosted convenience but loves that her newsroom can self-host.

**Persona B: Marcus, the small-firm urban planner / community organizer.** Works at a five-person planning consultancy or for a neighborhood association. Builds maps to argue for bike lanes, document zoning impacts, or coordinate volunteers. JTBDs: combine a city open-data shapefile with a hand-drawn proposal overlay; collect comments from non-technical stakeholders on a shared link; print to PDF for a council meeting; preserve the project as an archivable file his client can keep after the engagement ends. Pain points: ArcGIS Online seats are unaffordable; Google My Maps can't handle his polygons or layered analysis; QGIS scares his collaborators.

**Persona C: Dr. Ana, the field researcher / academic.** Ecologist, archaeologist, or social scientist running a small lab or grant-funded project. Has GeoTIFFs, GPX tracks, and CSVs from fieldwork. JTBDs: load multiple data formats without preprocessing, georeference a scanned historic map, annotate sites and route logistics with collaborators in three time zones, export both publication-ready PNGs and reproducible source files. Strongly prefers tools she can self-host on the university Linux box because her data is sensitive and her grant has no SaaS line item.

**Persona D: Jonas, the indie / hobbyist.** Hiker, worldbuilder, real-estate scout, or genealogist. Wants a beautiful private map of trails, fictional settings, candidate properties, or ancestral villages. JTBDs: drop pins with photos and notes, draw routes that snap to roads, share with a few friends or keep entirely private, and feel a sense of craft and ownership. He represents the long tail that gives the project its cultural energy and word-of-mouth.

A fifth latent persona — **the indie developer** who wants to embed a "draw on a map" widget in their own product — is out of MVP scope but will inform our SDK design from the start.

We are explicitly **not** building for: enterprise GIS analysts (their workflows require ArcGIS/QGIS depth we will not match), location-intelligence data scientists (Kepler.gl/CARTO own that), turn-by-turn navigation, or Esri-compatible enterprise integrations.

---

## 4. Jobs-to-be-Done

Across personas, three jobs dominate and structure the rest of this PRD:

1. **Import-and-share.** "I have a file (CSV, GeoJSON, KML, Shapefile, GeoTIFF). Get it onto a beautiful basemap and give me a link I can send within five minutes."
2. **Draw-and-annotate.** "I have a map and a story. Let me sketch routes, regions, arrows, callouts, and pins, with a few collaborators editing simultaneously, and let the result feel hand-crafted, not auto-generated."
3. **Present-and-embed.** "Lock down the camera, hide the chrome, generate a static PNG/PDF and a responsive iframe, and let me publish without paying per pageview."

Secondary jobs include offline/airgap use (Persona C), classroom use (a verified-free-for-edu policy), and lightweight field data collection (Personas B and C). These belong in v1.5 and beyond.

---

## 5. Product Principles

These principles are a tiebreaker, not a feature list.

- **Document, not database.** A map is a file. It is portable, diffable, exportable, and version-controlled. Cloud sync is an enhancement, never a prerequisite.
- **Local-first, collab-second.** Everything works on a laptop with no network. Real-time collaboration is layered on top via WebSockets, not assumed.
- **Hand-crafted, not auto-generated.** We inherit Excalidraw's slightly-rough aesthetic on annotation and explicitly reject "AI cartography" that produces glossy, generic maps. The map should look like the user made it.
- **Open formats over proprietary lock-in.** GeoJSON, PMTiles, MapLibre Style Spec, `.excalidraw` JSON. No bespoke binary formats.
- **One Docker command to self-host.** If install requires more than `docker compose up`, we have failed.
- **Boring, modular dependencies.** PostgreSQL + PostGIS optional, not required. SQLite + a flat-file PMTiles bucket is the default.
- **No surprise bills.** No telemetry that calls home, no required basemap key, no per-map pageview cap.

---

## 6. Competitive Positioning

A condensed view of the competitive map. We assess each on target user, license, self-hostability, and the "Felt-feel" — i.e., whether the tool achieves Felt's particular blend of polish, collaboration, and breadth.

| Tool | Target | License | Self-host | Felt-feel | What we learn |
|---|---|---|---|---|---|
| **Felt (post-pivot)** | Enterprise GIS, AI-native | Proprietary | No | Was the gold standard | Free tier death is our market |
| **Atlas.co** | SMB/teams | Proprietary SaaS | No | High; closest commercial heir | Validates the wedge; doesn't close it for OSS |
| **Kepler.gl** | Data analysts | MIT | Yes (React app) | Low — viz-first, not annotation | Steal: deck.gl perf for large datasets |
| **QGIS / QGIS Cloud** | GIS pros | GPL | Yes | None — desktop-first | Friend, not competitor; integrate via plugin |
| **Mapbox Studio** | Designers/devs | Proprietary | No | Style-only | Steal: style spec elegance (use MapLibre's fork) |
| **Google My Maps** | Casual consumers | Proprietary | No | Low | Floor we must clear easily |
| **Datawrapper** | Journalists | Proprietary | Limited | Medium — chart-first | Steal: opinionated typography defaults |
| **uMap** | OSM enthusiasts | AGPL | Yes | Medium — closest OSS sibling | Friend; we differ on collab, drawing, UX polish |
| **Maputnik** | Cartographers | MIT | Yes | None — style editor | Embed it as our style editor; don't rebuild |
| **Mapeo** | Indigenous communities | Various OSS | Yes (P2P) | None — offline-first vertical | Inspire: data-sovereignty messaging |
| **Penpot** | Designers | MPL-2.0 | Yes | n/a | GTM model — open-source-as-Figma-alternative |
| **Excalidraw** | Anyone | MIT | Yes | n/a | Our literal upstream |

**Our wedge:** the only tool that is *all* of (a) free, (b) self-hostable, (c) real-time collaborative, (d) excellent at freeform drawing on a real basemap, (e) supports prosumer-grade data import (CSV/GeoJSON/KML/Shapefile/GeoTIFF), and (f) embeds anywhere. uMap covers (a)–(b) and partially (c)–(f). Atlas covers (c)–(f) but not (a)–(b). The intersection is empty. That's the product.

---

## 7. Feature Scope by Phase

The scope below is opinionated about what *must* ship together for the product to feel like a product, not a tech demo.

### 7.1 MVP (target: ~3 months, single full-time-equivalent + community PRs)

The MVP delivers JTBD #1 (import-and-share) and a simplified version of JTBD #2 (draw-and-annotate). It is the "minimum lovable" demo we'd post to *Show HN: Open Felt*.

- **Map canvas.** MapLibre GL JS as the basemap layer, Excalidraw canvas overlaid in a coordinated coordinate space. Pan/zoom synchronized; Excalidraw shapes anchored to lng/lat (not screen pixels) by writing the geographic position into Excalidraw's `customData` field on each element.
- **Default basemaps.** Three baked-in styles served via OpenFreeMap (free public tiles) and a one-line config to switch to self-hosted Protomaps PMTiles. MapTiler/Stadia listed as optional commercial alternatives.
- **Drawing tools (Excalidraw subset, retuned for maps):** pin (with rich popup: title, description, photo, link), polygon, line, freehand pen/highlighter, text label, arrow, rectangle, circle (with radius readout in km/mi). Smart map-aware **route** tool that snaps to the road network (via a self-hostable OSRM or Valhalla instance, optional).
- **Data import.** Drag-and-drop for GeoJSON, KML/KMZ, GPX, CSV with lat/lng or address columns, single-file Shapefile zip, and GeoTIFF (rendered via a lightweight COG protocol). Address-column geocoding via configurable Photon/Nominatim/Pelias backend with a default rate-limited public Photon.
- **Layer panel.** Toggle visibility, reorder, simple per-layer color/stroke/opacity styling. Distinguish "annotations" (Excalidraw-native) from "data layers" (GeoJSON-backed) cleanly in the UI.
- **Real-time collaboration.** Excalidraw's existing WebSocket protocol, extended to broadcast map camera state and data-layer mutations. End-to-end encryption for shared rooms by default (inheriting Excalidraw's model). Cursors visible across users.
- **Sharing and permissions.** Three modes: private, view-only link, edit link. Optional account-bound permissions for self-hosters who turn on auth.
- **File format.** `.atlasdraw` = a zipped bundle of `scene.excalidraw.json` (Excalidraw scene with our customData), `data/*.geojson` (each imported layer), `style.json` (active MapLibre style reference), and `manifest.json` (camera, version, layer order). Fully readable by humans, diff-friendly, importable into Excalidraw and QGIS as a fallback.
- **Export.** PNG (high-res), PDF (single-page), GeoJSON of all annotations, and the raw `.atlasdraw` file.
- **Self-host story.** Single `docker-compose.yml` with three services: web (React app), realtime (WebSocket), storage (Postgres + S3-compatible blob — defaults to local volume + MinIO). One-command launch on any Docker host. No required external API keys.

### 7.2 v1.0 (target: +3 months)

v1.0 closes JTBD #3 (present-and-embed) and brings the polish that earns the "Felt-class" label.

- **Embed widget.** Stable iframe embed with sane responsive defaults, configurable chrome (legend on/off, attribution, camera lock), and a script-tag option that lazy-loads. SRI hash provided.
- **Comments and review mode.** Anchored comments on annotations, threaded replies, mention-by-handle, resolve/reopen. Modeled on Figma/Felt commenting, not Google Docs.
- **Style editor (embedded Maputnik).** Users can pick from 6–8 curated basemap styles or fork their own; we ship Maputnik in an iframe modal rather than rebuild a style editor.
- **Data styling for layers.** Categorical and graduated color ramps, point sizing by attribute, label fields, simple choropleth on uploaded boundary data. Cartographic defaults that "just work" — strong inspiration from Datawrapper's opinionated palette choices.
- **Spatial transforms.** Buffer, intersect, union, centroid, simplify, reproject — implemented with Turf.js, surfaced as a small "Transform" sidebar. Not analytics; just enough to unblock common tasks.
- **Print layout.** Multi-page PDF with title block, legend, scale bar, north arrow, custom page sizes (US Letter / A4 / Tabloid).
- **Asset library.** Reusable annotation libraries (`.excalidrawlib` compatible) — wildfire icons, transit symbols, hazard markers, custom team brand kits — including a curated default set under MIT.
- **Accessibility pass.** Keyboard nav, screen-reader announcements for selected features, high-contrast mode (we get a head start from MapLibre's a11y work).
- **Hosted multi-tenant mode.** Optional, off-by-default "managed mode" config that adds workspaces, billing hooks, and rate limits — for teams who want to run a small SaaS for their org or for the OSS-hosted-by-the-project flagship.

### 7.3 v1.5 (target: +6 months)

- **Field collection lite.** A mobile-friendly "submit a point" view that lets non-editors drop photo+location entries onto a layer (gated by token). Pulls inspiration from Mapeo and Atlas's field forms but stays scope-disciplined.
- **Plugin/extension API.** Drop-in JS modules registered via a manifest, similar in spirit to Felt's "Custom extensions" but transparent and reviewable. Pre-built extensions: search, measure, spatial filter, time-slider for dated data.
- **Natural-language layer styling.** Local-first AI integration (Ollama-compatible endpoint) for "make all roads orange where AADT > 10000" — entirely optional, key-bring-your-own. We do not lock features behind cloud AI.
- **Versioning and history.** Time-travel slider, named snapshots, exportable diff between versions. Particularly valuable for journalism (audit trail) and planning (council-meeting versions).
- **PostGIS direct connection** as a layer source for self-hosters who already have spatial databases.
- **QGIS bridge plugin.** Bidirectional: open an `.atlasdraw` in QGIS, push a QGIS layer into an Atlasdraw map. We follow Felt's lead here; QGIS is a peer, not a rival.

### 7.4 Future / Roadmap (no commitments)

- 3D buildings and terrain (MapLibre supports this; gate on user demand).
- Globe view for narrative scrolly-telling.
- True offline PWA mode (service worker + cached PMTiles range) for fieldwork.
- Native mobile apps via React Native + MapLibre Native.
- Federated/p2p sync (CRDT-based), inspired by Mapeo, for orgs that need data sovereignty.
- Storymap mode (sequenced camera transitions across map states).

---

## 8. Top User Flows

**Flow 1 — Import-and-share (Priya, 4 minutes).**
Lands on `app.atlasdraw.org` (or her self-hosted instance) → clicks "New map" → drags `incidents.csv` onto canvas. A modal detects address column, geocodes via Photon, and shows a styling preview. She accepts defaults; pins appear styled by category. She clicks "Share," copies a view-only link, pastes in Slack to her editor. The whole flow is keyboard-navigable; the geocoding modal shows progress and can be cancelled.

**Flow 2 — Draw-and-annotate (Marcus, ~15 minutes).**
Opens an existing map containing a shapefile of zoning districts. Switches to "Draw" mode in the toolbar (Excalidraw tools take focus, basemap dims slightly to indicate draw context). Sketches a polygon over a parcel, labels it "Proposed micro-housing," draws an arrow to a transit stop, drops a pin with a photo. Invites two collaborators by link; sees their cursors and pencils in real time. Right-clicks the polygon → "Convert to data layer" so it can be styled and exported as GeoJSON. Saves to local disk as `.atlasdraw`.

**Flow 3 — Present-and-embed (Priya again, 6 minutes).**
After her editor approves, Priya clicks "Publish" → toggles legend visibility, hides the toolbar, locks the camera bounds to her city, picks "Auto-fit on mobile." Copies the iframe snippet, pastes in her CMS, previews on mobile and desktop. The iframe is ~120 KB initial JS, lazy-loads tiles, and renders even if her CMS blocks scripts (graceful PNG fallback). She also exports a 2× PNG for the print edition.

---

## 9. Technical Architecture

The technical scaffold provided by the user remains authoritative for the integration mechanics; this section summarizes the architecture and extends it to deployment, data, and extensibility concerns the scaffold did not address.

**Client.** A single React/TypeScript SPA. Two stacked rendering surfaces: MapLibre GL JS (WebGL) on the bottom, Excalidraw canvas on top with `pointer-events` hand-off based on active tool. A coordination layer translates between (lng, lat) and (x, y) screen coordinates on every camera change, projecting Excalidraw elements via MapLibre's `project()` / `unproject()`. Each Excalidraw element carries a `customData.geo` object with `{ lng, lat, anchor: "topleft" | "center" | "polyline" }` so positions survive zoom/pan and are exportable as GeoJSON. Element version numbers (Excalidraw's existing CRDT-lite mechanism) handle conflict resolution; we add the geographic anchor as a tracked field.

**Real-time layer.** WebSocket server (Node + ws/Socket.IO), forking Excalidraw's `excalidraw-room` pattern. We extend the message schema with two new event types: `MAP_CAMERA_UPDATE` (throttled, last-write-wins) and `DATA_LAYER_MUTATION` (CRDT-merged via Yjs or Automerge for non-Excalidraw data). End-to-end encryption inherited from Excalidraw for the scene; data-layer encryption is opt-in (some self-hosters will want server-side processing).

**Storage.** Default: PostgreSQL for metadata + S3-compatible blob (MinIO in the default Docker stack) for `.atlasdraw` payloads and uploaded files. Files >10 MB (typical GeoTIFFs, Shapefile bundles) are streamed to blob storage and referenced by URL in the manifest. PostGIS is *not* required for MVP; we add it as an optional service in v1.5 for direct DB layer sources.

**Basemap and tiles.** Default basemap is OpenFreeMap's public instance for zero-friction first run. Self-hosters get a one-line switch to Protomaps PMTiles (single-file world basemap, ~120 GB, served directly from S3/CloudFront via HTTP range requests with no tile server). For private/airgap deployments, we ship Tilemaker recipes to build regional PMTiles from OSM PBF extracts.

**Geocoding and routing.** Default: rate-limited public Photon (Komoot's open instance) with a clear "configure your own" upsell. Self-hosters can point at a local Photon, Nominatim, or Pelias container; routing similarly defaults to a public OSRM and supports BYO Valhalla.

**Spatial operations.** Turf.js in the browser for buffer/union/intersect/simplify; we deliberately avoid server-side analysis in v1 to keep the deployment story trivial.

**Style editor.** Maputnik embedded in an iframe, communicating via `postMessage`. We don't fork or re-skin it; we contribute upstream.

**Plugin/extension API (v1.5).** A small registration interface — `registerTool({ id, icon, onActivate, onCanvasEvent })` and `registerLayerType({ id, parse, render })` — backed by a manifest file. No remote code execution; extensions ship as static bundles a self-hoster reviews and drops in.

**Build and distribution.** Monorepo (pnpm workspaces): `app/` (React SPA), `realtime/` (WebSocket server), `cli/` (file format tools, headless export), `sdk/` (embeddable widget), `docs/` (Astro site). Reference deployment: `docker-compose.yml` with `web`, `realtime`, `postgres`, `minio`. A second `docker-compose.cloud.yml` adds Caddy for TLS, a Photon container, and a tile-serving nginx with a sample PMTiles file.

**Performance budget.** 60 fps pan/zoom with up to 50,000 GeoJSON features (deferring to MapLibre's vector rendering). Initial bundle <300 KB gzipped for the embed widget; <800 KB gzipped for the editor. First meaningful paint under 1.5 s on a cold cache, 4G connection.

---

## 10. Success Metrics

We measure impact, not vanity, but we are honest that for an OSS project with no marketing budget, GitHub stars and Show HN discussion are leading indicators of community traction.

**Year 1 targets (aspirational, calibrated against Plausible/Penpot/uMap reference points):**

- **Adoption:** 5,000 GitHub stars; 500 self-hosted installs reporting (anonymous, opt-in heartbeat) within Y1.
- **Hosted flagship (if we run one):** 3,000 monthly active map editors; 25,000 unique embed views; <8% week-1 to week-4 churn on free accounts.
- **Quality and engagement:** ≥40% of new maps reach "shared" state (proxy for completion); ≥1 collaborator on ≥20% of maps; median time-to-first-map under 8 minutes.
- **Community health:** ≥40 external contributors (≥1 merged PR); ≥3 maintained downstream forks/integrations; one public reference deployment per persona (a newsroom, a planning shop, a research lab, a hobbyist community).
- **Format portability proof:** ≥1 third-party tool reads/writes `.atlasdraw` natively.

**Lagging metrics we explicitly do not optimize for:** monthly recurring revenue (ours is a tool, not a startup), enterprise deal count, or feature parity with ArcGIS Online.

---

## 11. Go-to-Market for an Open-Source Project

OSS GTM is reputation-and-distribution work, not advertising. We will execute the standard playbook with discipline.

**Pre-launch (months 1–3):** Build in public on the GitHub repo from day one. Weekly "dev log" blog posts. Recruit 5–10 design partners across the four personas; ship them weekly TestFlight-style builds. Publish the PRD itself (this document) as the README's vision link. Reserve handles on X, Mastodon, Bluesky, GitHub org, and the npm scope.

**Launch venues, sequenced:**
1. **Show HN: "Open-source Felt alternative — Excalidraw + MapLibre"** — single most important launch surface. Post on a Tuesday morning ET. Headline must lead with the Felt comparison; HN rewards specificity.
2. **r/gis, r/selfhosted, r/datajournalism, r/openstreetmap, r/urbanplanning.** Each gets a tailored framing.
3. **Mapping Twitter/X and Bluesky** — tag the cartography crowd (Tim Wallace, Ken Field, Mapping Mashups crew, etc.); Felt's former community is unusually concentrated there.
4. **MapLibre, Protomaps, OpenStreetMap forums** — frame as a downstream success story; avoid implying we replace them.
5. **Newsletters and podcasts:** *Mapscaping*, *MapDive*, *Pointer*, *Source* (OpenNews), *console.dev*. Pitch each well in advance.
6. **Conference circuit:** NACIS, FOSS4G, SRCCON, IRE/NICAR. Lightning talks first, workshops by year 2.

**Positioning headline:** *"The open-source map studio. Self-hostable. Permissively licensed. As easy as a Google Doc."* Avoid "Felt killer" framing in copy (legal risk + bad community optics) — but engineer the metadata so people searching "Felt alternative" find us.

**Naming.** *Atlasdraw* leads on three criteria: (a) implies the Excalidraw heritage clearly, (b) "atlas" carries cartographic weight without being literal, (c) `atlasdraw.org` and the npm scope appear available as of research date. Backup names: *Cartograph*, *Plotpaper*, *Foliomap*, *Kart* (Norwegian for map; pleasingly short). Avoid: anything with "map" + a generic suffix (overcrowded), anything trademark-adjacent to Felt or Atlas.co.

**Monetization model.** Pure OSS for the project; an optional managed-hosting flagship in v1.0 funded by usage tiers (free for personal/edu, $9–19/mo for pro hosted, custom for orgs). All managed-hosting features ship in the OSS code under AGPL — no open-core split. Revenue funds maintainer time on the core. We follow Plausible's model more than n8n's: feature parity is a brand value. A lightweight sponsorship model (GitHub Sponsors, Open Collective) supplements from day one.

**License rationale.** AGPL-3.0 for the application protects against hyperscaler resale; MIT for the embed SDK and `.atlasdraw` CLI tools maximizes ecosystem adoption. We document this choice prominently — license confusion is the single biggest issue raised in OSS-tool HN threads (per the Plausible and Windmill discourse).

---

## 12. Risks and Mitigations

We catalog the credible risks now to keep them from becoming surprises.

**Technical: Excalidraw–MapLibre coordinate drift.** The single hardest engineering problem is keeping freeform Excalidraw shapes geographically anchored under arbitrary zoom/pan, including tilt and rotation. Fonts and stroke widths must scale sensibly. *Mitigation:* commit to a clear semantic — "annotations are pinned at a reference zoom and scale linearly outside ±2 zoom levels" — and ship a visual debugging mode early. Lean on MapLibre's `project/unproject`, not custom math.

**Technical: real-time merge conflicts on layered data.** Excalidraw's last-write-wins-by-version is fine for sketches but poor for structured layer edits. *Mitigation:* dual-track — keep Excalidraw's protocol for annotation elements; introduce a Yjs/Automerge document for data-layer mutations.

**Technical: bundle size and cold-start.** Excalidraw + MapLibre + Maputnik + Turf is bulky. *Mitigation:* code-split aggressively, lazy-load Maputnik and Turf, use a slim embed bundle distinct from the editor.

**Market: Atlas.co dominates.** Atlas is well-funded and ships fast. *Mitigation:* we don't compete on features; we compete on *self-hosting and license*. The customer who wants Atlas will buy Atlas; the customer who wants ownership will pick us. Our roadmap explicitly does not chase Atlas's app-builder.

**Market: Felt revives a free tier.** Possible but unlikely given the enterprise pivot and Energize's investment thesis. *Mitigation:* file format portability — if Felt reopens, our users can move freely. We also offer a Felt importer in v1.0.

**Legal: basemap and data licensing.** OSM data requires attribution; some commercial tile services prohibit certain redistribution patterns. *Mitigation:* default-on attribution that cannot be programmatically removed (only repositioned); a clear basemap-source matrix in docs; Protomaps/OpenFreeMap as the recommended defaults to sidestep entirely.

**Legal: AGPL fear.** Some adopters confuse AGPL with "you must open-source your whole company." *Mitigation:* a plain-English LICENSE-FAQ covering common scenarios (embedding the iframe in a closed-source SaaS is fine; modifying the server and exposing it as a SaaS is not).

**Operational: maintainer burnout.** The defining failure mode of OSS prosumer tools (uMap has felt this; Mapeo has too). *Mitigation:* a two-maintainer rule (no single point of failure on merge), explicit "no support SLA" framing for community users, GitHub Sponsors and Open Collective from day one, and a clearly communicated bus factor.

**Operational: scope creep into "we're rebuilding QGIS in a browser."** *Mitigation:* §13 is the firewall.

**Reputational: AI-generated cartography backlash.** Cartographers are quick (rightly) to call out plausible-but-wrong AI maps. *Mitigation:* we treat AI as a styling/scaffolding helper, not a content generator. No "AI map this for me" button.

---

## 13. Out of Scope (and Why)

Stating non-goals up front is the cheapest contributor-alignment tool we have.

- **Full GIS analysis suite.** No raster algebra, no network analysis, no geostatistics. QGIS exists; we plug into it.
- **Enterprise auth, audit, SSO, SOC 2.** These belong to a hosted commercial fork or v2+ optional plugins, not the OSS core.
- **Esri compatibility.** No `.lyr` parsing, no ArcGIS Online sync. The Esri ecosystem is a distinct universe.
- **Turn-by-turn navigation.** We display routes; we don't navigate them. OsmAnd, Organic Maps, and Komoot own this.
- **Heavy 3D / scientific visualization.** deck.gl wrappers later, maybe; not v1.
- **Closed-source forks and a managed monetization moat.** We ship everything under AGPL and accept the consequences.

---

## 14. Open Questions

These are the live debates founders should resolve in the first six weeks.

- **Does the WebSocket server become a hard dependency or is "single-player + file save" a first-class deployment mode?** Strong argument for the latter — the laptop-airplane-mode story is differentiating. Probable answer: yes, ship a single-binary mode.
- **Yjs or Automerge for data-layer CRDT?** Yjs has the larger ecosystem; Automerge has cleaner semantics. Spike both in week one.
- **Default basemap: ship with OpenFreeMap or self-host Protomaps day one?** OpenFreeMap is faster to ship but introduces a third-party dependency in our default config. Recommended: use OpenFreeMap as the demo default with a prominent "self-host this" callout, and make Protomaps PMTiles a one-line config switch.
- **Hosted flagship: do we run one?** Strongly yes, by v1.0 — it funds maintainer time and acts as the canonical demo. Run it under a separate brand (`atlasdraw.app` or `studio.atlasdraw.org`) so the OSS project stays pristine.
- **AGPL vs MPL-2.0 for the app?** AGPL is a stronger moat against SaaS-resellers; MPL is more contribution-friendly. Recommendation: AGPL for the app, MPL/MIT for SDK and CLI.

---

## 15. First Sixty Days: Concrete Plan

To make this PRD operational rather than aspirational, the first two months should produce:

- **Week 1–2:** Repo, license file, code of conduct, issue templates, contributor's guide, a `/decisions/` ADR folder with the first three ADRs (license choice, real-time architecture, default basemap). A working spike: Excalidraw rectangle anchored to a real lng/lat surviving pan/zoom.
- **Week 3–4:** Coordinate-sync layer hardened. Drag-and-drop GeoJSON import. PNG export. Basic share link (single-player, file-based, no realtime yet). First public repo announcement on Mastodon/Bluesky in mapping circles for early-eye feedback.
- **Week 5–6:** WebSocket realtime, multi-cursor. CSV-with-address import via configurable Photon. Three-style basemap picker. Docker compose stack working end-to-end.
- **Week 7–8:** Embed widget MVP. Comment threads. First closed-beta with the four design-partner archetypes. Begin drafting the Show HN post; reserve the launch date for week 10–12.

If any of these milestones slip by more than 50%, the architecture or the team is wrong, and the PRD should be revised before pushing further.

---

## 16. Closing Note

The Felt window opened in 2021 and effectively closed for the prosumer in early 2025. The geospatial stack required to rebuild it as open-source — MapLibre's vector rendering, Protomaps' single-file world, Excalidraw's collaboration primitives, Tippecanoe and Planetiler's tile pipelines, Photon and Pelias for geocoding, Turf.js for spatial ops — is all there, mature, and permissively licensed. The technical work is meaningful but tractable for a small focused team. The product question is whether we have the discipline to *not* build a GIS, *not* chase the enterprise market, and *not* lose the hand-crafted, document-shaped feel that made Felt so loved in the first place.

Atlasdraw's job is to keep that window open — for the journalist on deadline, the planner with a council meeting tomorrow, the researcher in a forest with no LTE, and the hobbyist who just wants their hike on a beautiful map. The rest follows from there.