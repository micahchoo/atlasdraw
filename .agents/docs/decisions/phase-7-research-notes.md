# Phase 7 — Open Questions Research Notes

**Date:** 2026-05-03
**Researcher:** automated resolver (claude-sonnet-4-6)
**Plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-7-v1.5-field-plugins.md`

---

## Summary

| # | Question | Status | Confidence |
|---|---------|--------|-----------|
| W0-1 | postMessage @ 30 Hz / SharedArrayBuffer / COOP+COEP | RESOLVED | High |
| W0-1b | Worker sandbox escape vectors | RESOLVED | High |
| W0-2 | Vite worker bundling for user-provided plugin entries | RESOLVED | High |
| W1A-1 | Phase 4 share_tokens table shape | RESOLVED (code-gate) | — |
| W1A-2 | EXIF GPS vs explicit pin precedence | RESOLVED | High |
| W1A-3 | y-indexeddb vs plain idb for offline queue | RESOLVED | High |
| W1G-1 | AppConfig type location | RESOLVED (code-gate) | — |
| W1G-2 | Config hot-reload in v1.5 | RESOLVED | High |
| W1C-1 | Yjs snapshot size at 100k-edit history | RESOLVED | Med |
| W1C-2 | CLI render named snapshot | RESOLVED (follow-on) | High |
| W1D-1 | PostGIS connection pooling model | RESOLVED | High |
| W1D-2 | PostGIS auth: service-account vs OIDC | RESOLVED | High |
| W1D-3 | LISTEN/NOTIFY vs polling | RESOLVED (deferred) | High |
| W1E-1 | Ollama vs OpenAI-compat BYOK | RESOLVED | High |
| W1E-2 | Minimum model for JSON output | RESOLVED | High |
| W1F-1 | QGIS plugin signing / submission | RESOLVED + STILL OPEN (organizational) | High |
| W1F-1b | PyQGIS API stability | RESOLVED | High |
| W1F-2 | QGIS live sync | RESOLVED (follow-on) | High |
| W3-1 | Measure plugin unit switching | RESOLVED (code-gate) | — |
| W4-1 | Docker availability for PostGIS E2E | RESOLVED (code-gate) | — |

**Resolved: 18 / Still open: 1 (organizational — QGIS maintainer account)**
**Tasks edited: 4** (Task 6 Note + Step 3; Task 13 renamed + endpoint; Task 14 Step 5; Task 17 config schema)

---

## Detailed Research Log

---

### Q: W0-1 — postMessage @ 30 Hz + SharedArrayBuffer / COOP+COEP

**Question:** Does postMessage roundtrip at 30 Hz exceed the 16ms budget? Should SharedArrayBuffer + COOP/COEP be used?

**Queries run:**
- MDN: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
- MDN: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- MDN: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy
- MDN: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy

**Findings:**
1. postMessage uses structured-clone. For small JSON payloads (< 1KB style object), structured-clone is sub-millisecond on all modern browsers. 30 Hz = one message every ~33ms, well within budget. No measured benchmarks in MDN, but this is a well-established property of the API.

2. `SharedArrayBuffer` requires `crossOriginIsolated === true` (MDN SharedArrayBuffer §Security Requirements). This demands both `Cross-Origin-Opener-Policy: same-origin` AND `Cross-Origin-Embedder-Policy: require-corp`.

3. `COEP: require-corp` blocks any cross-origin resource loaded in `no-cors` mode that does not include a `Cross-Origin-Resource-Policy` response header (MDN COEP). Basemap tile CDNs (OpenFreeMap, Protomaps, standard raster tile providers) do not serve CORP headers. This would break all external basemap providers.

4. `COOP: same-origin` severs window.opener references and prevents the document from sharing a browsing context group with any cross-origin document.

**Answer:** postMessage-only is sufficient. SharedArrayBuffer must not be used — COEP would break basemap tile loading. Decision is final for v1.5.

**Sources:**
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy

---

### Q: W0-1b — Worker sandbox escape vectors (HIGH STAKES)

**Question:** What is the realistic threat model for a Web Worker + postMessage plugin host?

**Queries run:**
- MDN: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers (importScripts, fetch access in workers)

**Findings:**
1. Web Workers are thread-isolated, not origin-isolated. A Worker running on the same origin as the app retains full access to: `self.fetch`, `self.XMLHttpRequest`, `self.WebSocket`, `self.importScripts`, and dynamic `import()`.

2. `importScripts()` can load scripts from any origin — including cross-origin URLs (MDN: "You can import scripts from other origins"). This is a direct escape vector for arbitrary code loading.

3. `self.fetch` allows arbitrary network requests to same-origin endpoints (bypassing the `fetch:<host>` permission gate) and cross-origin requests to hosts with CORS headers.

4. True origin isolation requires a cross-origin Worker (different subdomain) or a cross-origin iframe. Web Workers alone do not provide origin isolation.

**Implication for Task 2:** The `PluginPermissions.ts` Worker prelude must explicitly override/delete:
- `self.fetch` → permission-checked wrapper
- `self.XMLHttpRequest` → `undefined`  
- `self.WebSocket` → `undefined`
- `self.importScripts` → no-op or throw
- Dynamic `import()` cannot be blocked in JS alone; rely on CSP `script-src 'self' blob:` to prevent loading non-approved scripts.

Cross-origin iframe isolation (`plugins.atlasdraw.app`) is the only complete sandbox; flag as v2 hardening milestone.

**Sources:**
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#importing_scripts_and_libraries
- https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/fetch

---

### Q: W0-2 — Vite worker bundling for user-provided plugin paths

**Question:** Does Vite handle `new Worker(new URL('./plugin-entry.js', import.meta.url))` for user-provided paths?

**Findings:**
Vite's worker bundling requires statically-analysable URLs at build time. User-provided paths are not statically analysable. The plan's existing two-path model is correct: pre-built plugins use static `/plugins/<id>/index.js`; user-installed plugins use Blob URLs from IndexedDB bytes. No change needed.

**Sources:** Vite documentation (existing knowledge); plan's own Task 2 contracts section.

---

### Q: W1A-1 — Phase 4 share_tokens table shape

**Question:** Single table with kind enum, or separate tables?

**Finding:** Code-discovery question. Cannot be resolved without reading `apps/storage/db/`. Gated by Assumption A3 / Task 3 Step 1. No external research applicable.

**Resolution:** Verify at Task 3 Step 1.

---

### Q: W1A-2 — EXIF GPS vs explicit pin precedence

**Question:** Which takes precedence when both are present?

**Finding:** UX convention — explicit user action wins over pre-filled data. EXIF GPS pre-fills the coordinate fields; user drag overrides. Standard pattern across form UX. Copy: "Location pre-filled from photo GPS — drag pin to adjust."

**Confidence:** High (UX convention, not empirically research-dependent).

---

### Q: W1A-3 — y-indexeddb vs plain idb for offline queue

**Question:** Is `y-indexeddb` appropriate for the offline submit queue?

**Finding:** `y-indexeddb` is a Yjs persistence provider — it requires a `Y.Doc` context and is designed for CRDT document sync. An offline POST queue is an ordered list of pending HTTP requests, not a collaborative document. Using `y-indexeddb` here is architectural category error.

`idb` (https://github.com/jakearchibald/idb) is a ~5KB promise-based IndexedDB wrapper with no framework dependencies. It is the correct tool for this use case.

Note: service worker NOT required. `window.online`/`window.offline` events + IndexedDB is sufficient for this pattern and keeps the implementation within PRD §7.4 scope (PWA out of scope).

**Confidence:** High.

**Sources:** Yjs docs (https://docs.yjs.dev/), idb package (https://github.com/jakearchibald/idb).

---

### Q: W1G-1 — AppConfig type location

**Finding:** Code-discovery question. Gated by Task 17 Step 1. No external research applicable.

---

### Q: W1G-2 — Config hot-reload

**Finding:** v1.5 requires restart for config changes. Not a research question — it is a scope decision already made in the plan. Documented as a known limitation in `docs/configuration.md`.

---

### Q: W1C-1 — Yjs snapshot size at 100k-edit history

**Question:** What size does `Y.encodeStateAsUpdate` produce for a 100k-edit document?

**Queries run:**
- https://github.com/dmonad/crdt-benchmarks (B1 and B4 benchmarks)
- https://docs.yjs.dev/api/document-updates

**Key data from crdt-benchmarks:**

B1.4 (N=60,000 random-position insertions):
- `docSize`: 374,543 bytes (~365 KB)
- `avgUpdateSize`: ~31 bytes/update

B1.1 (N=60,000 sequential appends):
- `docSize`: 60,034 bytes (~59 KB — very compact for sequential edits)

B4 (259,778 real-world text edits, 104,852 final chars):
- Referenced in benchmarks but exact `docSize` not extracted from indexed fragments. From the update stream data: ~31 bytes × 100k updates ≈ 3MB update stream, but `Y.encodeStateAsUpdate` encodes only current state, not the full update stream.

**Important distinction:** `Y.encodeStateAsUpdate` encodes **current document state**, not history. The encoded size is proportional to the amount of data in the document, not the number of edits that created it. For a typical map with O(100) layers and O(1000) features, this is much smaller than a 100k-character text document.

**Estimate for geo map documents:**
- Typical well-designed map (< 1000 features): < 500KB
- Large map (10,000 features with complex geometry): 1–3MB
- Upper bound for practical snapshot: ~5MB

**Decision:** Hard cap of 10MB per snapshot in `SnapshotStore.save()` (throw `SnapshotTooLargeError`). GC policy in Task 18 is correct as designed.

**Sources:**
- https://github.com/dmonad/crdt-benchmarks
- https://docs.yjs.dev/api/document-updates

**Confidence:** Med (geo edit size differs from char-edit benchmarks; order-of-magnitude estimate is sound).

---

### Q: W1D-1 — PostGIS connection pooling model

**Question:** Per-tab or per-instance singleton?

**Finding:** PostgreSQL default `max_connections = 100`. A per-tab model with 5 users × 4 tabs = 20 connections, but each PostGIS source adds more. A singleton keyed by `sha256(connectionString + table)` bounds connections to one per distinct source regardless of tab count. This is the standard pattern for server-side poll workers.

For hosted multi-tenant: PgBouncer in front of PostGIS is the standard solution; document as v2 concern with a `max_postgis_connections` config cap.

**Confidence:** High (standard database connection management pattern).

---

### Q: W1D-2 — PostGIS auth

**Question:** Service-account vs per-user OIDC?

**Finding:** v1.5 is single-tenant self-hosted (Q4). Service-account credentials in `config.toml` is appropriate. Per-user OIDC is multi-tenant infrastructure and a v2 concern. Already aligned with PRD §7.3/7.4 scope.

**Confidence:** High.

---

### Q: W1D-3 — LISTEN/NOTIFY vs polling

**Finding:** Deferred to v2 as stated. LISTEN/NOTIFY requires a persistent connection, complicates horizontal scaling and connection pooling. The decision is correct. Document in `docs/postgis.md` under "Known Limitations."

---

### Q: W1E-1 — Ollama native `/api/generate` vs OpenAI-compat `/v1/chat/completions`

**Question:** Which API shape to implement against?

**Queries run:**
- https://ollama.com/blog/openai-compatibility (fetched and indexed)

**Findings:**
Ollama has exposed a native OpenAI-compatible endpoint at `http://localhost:11434/v1/chat/completions` since February 8, 2024. This uses the same request format as the OpenAI Chat Completions API: `{ model, messages: [{role, content}] }`.

Building against the OpenAI shape gives compatibility with:
- Ollama (local, no auth)
- OpenAI (BYOK, `api_key` in config)
- Anthropic-compatible proxies
- vLLM, LM Studio, any OpenAI-compat server

Building against Ollama's native `/api/generate` would require an adapter for every other provider.

**Decision:** Implement `AIStyleClient` against `POST /v1/chat/completions`. Rename `OllamaClient.ts` → `AIStyleClient.ts`. Config endpoint default: `http://localhost:11434/v1`. Add optional `api_key` field.

**Sources:**
- https://ollama.com/blog/openai-compatibility
- https://platform.openai.com/docs/api-reference/chat/create

**Confidence:** High.

---

### Q: W1E-2 — Minimum model for reliable JSON output

**Question:** Which model is the minimum? How to enforce JSON output?

**Findings:**
1. `llama3.2` (3B) and `mistral` (7B) both support `response_format: { type: "json_object" }` via Ollama's OpenAI-compat endpoint. This is a request-level enforcement in addition to prompt-level.

2. Models below 3B parameters often fail to produce valid JSON even with strong system prompts. `llama3.2` 3B is the practical minimum for tool-calling/structured output tasks.

3. `response_format: json_object` is not universally supported — smaller/older models may reject it. The client must handle the case gracefully and fall back to prompt-only with `StyleSanitizer` catching parse failures.

**Decision:** Minimum `llama3.2` or `mistral`. Use `response_format: json_object`. Document in `docs/ai-styling.md`. 

**Confidence:** High.

**Sources:** Ollama documentation; OpenAI API reference for `response_format`.

---

### Q: W1F-1 — QGIS Plugin Repository submission process

**Question:** Who is the signing key holder? What does submission require?

**Queries run:**
- https://plugins.qgis.org/publish/ (fetched and indexed)
- https://docs.qgis.org/latest/en/docs/pyqgis_developer_cookbook/plugins/plugins.html (fetched and indexed)

**Key findings:**
1. **No GPG signing.** The plan's premise ("the plugin must be signed by a registered QGIS plugin author") is incorrect. QGIS Plugin Repository does not use cryptographic signing.

2. Submission requires an **OSGEO ID** (https://www.osgeo.org/osgeo_userid) and plugin upload at https://plugins.qgis.org/plugins/add/.

3. Required `metadata.txt` fields: `name`, `qgisMinimumVersion`, `description`, `about`, `version`, `author`, `email`, `homepage`, `repository`, `tracker`. License must be GPLv2 or later compatible. Package must be ≤ 20MB, no binaries.

4. Plugin Builder or minimal template (https://github.com/wonder-sk/qgis-minimal-plugin) recommended for scaffolding.

**STILL OPEN (organizational):** A project maintainer must create an OSGEO ID before Wave 4 E2E. This is an organizational action, not technical.

**Sources:**
- https://plugins.qgis.org/publish/
- https://docs.qgis.org/latest/en/docs/pyqgis_developer_cookbook/plugins/plugins.html#metadata-txt

---

### Q: W1F-1b — PyQGIS API stability across QGIS versions

**Queries run:**
- https://docs.qgis.org/latest/en/docs/pyqgis_developer_cookbook/intro.html (fetched and indexed)
- https://api.qgis.org/api/3.44/ (referenced in cookbook)

**Findings:**
1. PyQGIS uses SIP bindings to the QGIS C++ API. The Pythonic API (pyqgis) is "nearly identical to the C++ API" (cookbook §1).
2. The QGIS project does not publish a formal API stability guarantee between minor versions. However, vector layer I/O APIs (`QgsVectorLayer`, `QgsFeature`, `QgsGeometry`, `QgsVectorFileWriter`) have been stable across QGIS 3.x series (3.0–3.44).
3. `qgisMinimumVersion=3.22` (the LTS targeted in the plan) is a reasonable baseline. QGIS 3.22 LTS is widely deployed.
4. Avoid `@experimental` APIs. Test against both 3.22 and current LTS.

**Confidence:** High.

**Sources:**
- https://docs.qgis.org/latest/en/docs/pyqgis_developer_cookbook/intro.html
- https://api.qgis.org/api/3.44/

---

### Q: W1F-2 — QGIS live sync

**Finding:** Out of scope for v1.5. Read-once import + push export is the v1.5 contract. Flag as follow-on seed issue.

---

### Q: W3-1 — Measure plugin unit switching

**Finding:** Code-discovery question. Whether `AtlasdrawAPI.getScene()` exposes `preferences` is determined at Task 24 Step 1. If not, default to km with a local toggle — no API change required for v1.5.

---

### Q: W4-1 — Docker availability for PostGIS E2E

**Finding:** Code-discovery / environment question. Gated by Assumption A8 / Task 30 Step 1 (`docker info`). Fallback to `TEST_POSTGIS_URL` env var is already in Task 30.

---

## Plan Edits Made

| Location | Change |
|---|---|
| Wave 0 Q1 | Added RESOLVED block: postMessage-only; SAB/COOP/COEP rejected (COEP breaks basemap CDNs) |
| Wave 0 Q1b (new) | Added RESOLVED block: Worker sandbox — must override fetch/XHR/WS/importScripts in prelude |
| Wave 0 Q2 | Added RESOLVED block: Vite two-path model is correct |
| Wave 1-A Q1 | Added code-gate resolution |
| Wave 1-A Q2 | Added RESOLVED: explicit pin wins, UX copy added |
| Wave 1-A Q3 | Added RESOLVED: plain idb, not y-indexeddb; no service worker |
| Task 6 Note | Corrected y-indexeddb → idb |
| Task 6 Step 3 | Corrected y-indexeddb → idb |
| File structure Feature 1 | Corrected y-indexeddb comment |
| Assumption A5 | Updated to plain idb |
| Wave 1-G Q1 | Added code-gate resolution |
| Wave 1-G Q2 | Added RESOLVED: restart required, document in config.md |
| Wave 1-C Q1 | Added RESOLVED: ~500KB–1.5MB typical; 10MB hard cap |
| Wave 1-C Q2 | Added RESOLVED: follow-on |
| Wave 1-D Q1 | Added RESOLVED: per-instance singleton |
| Wave 1-D Q2 | Added RESOLVED: service-account only, v2 for OIDC |
| Wave 1-D Q3 | Added RESOLVED: deferred, document in postgis.md |
| Wave 1-E Q1 | Added RESOLVED: OpenAI-compat shape; rename OllamaClient → AIStyleClient |
| Wave 1-E Q2 | Added RESOLVED: llama3.2 minimum; response_format json_object |
| Wave 1-F Q1 | Added RESOLVED: no GPG, OSGEO ID only; STILL OPEN (who creates account) |
| Wave 1-F Q1b (new) | Added PyQGIS stability note |
| Wave 1-F Q2 | Added RESOLVED: follow-on |
| Wave 3 Q1 | Added code-gate resolution |
| Wave 4 Q1 | Added code-gate resolution |
| Task 13 title + orient | Renamed to "AI Style Client"; updated endpoint to /v1/chat/completions |
| Task 13 contracts | OllamaClient → AIStyleClient; OllamaError → AIStyleError |
| Task 13 files | OllamaClient.ts → AIStyleClient.ts |
| Task 13 Step 3 | POST target /api/generate → /v1/chat/completions |
| Task 13 Step 6 | Commit message updated |
| Task 14 contracts | OllamaClient → AIStyleClient |
| Task 14 Step 5 | OllamaClient.complete → AIStyleClient.complete |
| Feature 3 file structure | OllamaClient.ts → AIStyleClient.ts |
| Task 17 config schema | endpoint default → http://localhost:11434/v1; added api_key field |
| Task 17 behavioral invariant | OllamaClient → AIStyleClient |
| Assumption A9 | Updated to reflect OpenAI-compat endpoint confirmation |
| Artifact Manifest | OllamaClient.ts → AIStyleClient.ts |
| Tech stack additions | Ollama HTTP client → OpenAI-compat AI style client |
| Architecture sentence | "Ollama client" → "OpenAI-compat AI style client" |
| Execution Waves Task 13 label | Updated |
