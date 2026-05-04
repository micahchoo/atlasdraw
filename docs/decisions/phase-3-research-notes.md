# Phase 3 Research Notes — Open Questions Resolution

**Date:** 2026-05-03
**Resolver:** open-questions-resolver agent
**Companion plan:** `docs/superpowers/plans/2026-05-03-atlasdraw-phase-3-file-format.md`
**Purpose:** Primary-source citations and reasoning for each resolved open question.

---

## Q1 — FSA permission lifecycle across browser sessions

**Primary source:** MDN `FileSystemHandle.queryPermission()` — https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission

**Key quote (MDN, queryPermission return value):**
> "Usually handles returned by the local file system handle factories will initially resolve with 'granted' for their read permission state. However, other than through the user revoking permission, **a handle retrieved from IndexedDB is also likely to resolve with 'prompt'**."

**Key quote (MDN, requestPermission security):**
> "Transient user activation is required. The user has to interact with the page or a UI element in order for this feature to work."

**What this means concretely:**
- Storing a `FileSystemFileHandle` in IndexedDB works across sessions (the handle serializes fine).
- On page reload, `queryPermission({ mode: 'readwrite' })` on a stored handle will return `'prompt'` — not `'granted'`. Chrome does NOT persist `readwrite` permission across sessions (even if the user granted it before). This is intentional browser security policy.
- `requestPermission()` requires a user gesture (button click) — it cannot be called on page load silently.
- Browser support: Chrome/Edge (both Chromium) support FSA including `queryPermission`/`requestPermission`. Firefox and Safari do NOT support the File System Access API (as of 2026). MDN marks both `queryPermission` and `requestPermission` as "Limited availability / not Baseline."

**Resolution chosen:** Option (c) from the plan — store the handle in IndexedDB, but always use `showSaveFilePicker` on first save per session. On subsequent saves within the same session, re-use the stored handle (permission is still `'granted'` within a session). On next session, `queryPermission` returns `'prompt'`, so call `requestPermission()` gated on a user click — specifically, the "Save" button click itself satisfies the transient user activation requirement.

**Fallback for Firefox/Safari:** `showSaveFilePicker` is undefined. Fall back to `<a download>` blob URL trigger for save, `<input type="file">` for open. These are already spec'd in Task 8 Step 4.

---

## Q2 — `style.json`: snapshot vs registry reference

**Primary source:** MapLibre Style Spec root — https://maplibre.org/maplibre-style-spec/root/

**Relevant facts from spec:**
- A MapLibre style is a self-contained JSON document: `version`, `sources`, `layers`, `sprite`, `glyphs` — all resolvable without an external registry.
- `sources` entries contain tile URL templates; `sprite` and `glyphs` contain URL templates. A "snapshot" style must either inline these or point to stable public URLs. A full snapshot of a Protomaps or OpenFreeMap style includes remote tile/sprite/glyph URLs — it is portable for reading but requires those URLs to resolve for rendering.
- There is no MapLibre concept of a "style registry ID" — that is a Atlasdraw-internal concept (`basemap.type: 'registry'`).

**Resolution:** Belt-and-suspenders as proposed in the plan: `manifest.json` carries `basemap: { type: 'registry', id: 'protomaps-light' }` (small, canonical ID for the app's registry). `style.json` inside the zip carries the full MapLibre style JSON snapshot (portable, renders without the registry). The app prefers the registry on open (fast, current style version); falls back to `style.json` if the registry ID is unknown (e.g., self-hosted instance with different basemap config). This is a design decision — no external authority arbitrates it.

---

## Q3 — Auto-save debounce window

**Resolution:** Design decision, no external authority. Trailing-edge debounce with 5s wait AND 30s maximum flush (ceiling timer). Rationale: fixed interval wastes writes when idle; unbounded debounce risks >30s data loss on fast typists. The 5s/30s pair is the standard pattern used by Google Docs (empirically observed) and recommended in the `optimistic-ui-vs-data-consistency` codebook pattern. No external citation needed.

---

## Q4 — Thumbnail render trigger

**Resolution:** Design decision. Only on explicit "Save to disk." Rationale: off-screen Excalidraw canvas re-render is 50–200ms (spec §8 budget is <8ms for coord-sync; thumbnail is outside that hot path but still non-trivial). Auto-save to IndexedDB skips thumbnail — IDB is a crash-recovery store, not a presentation store. No external citation needed.

---

## Q5 — `.atlasdraw.json` vs zip in IndexedDB

**Status:** Already settled in plan. IDB stores zip Blob (via `write()`); `writeJSON()` reserved for explicit user export and CLI `--json` flag. No research needed; marked closed.

---

## Q6 — CSV heuristic threshold

**Resolution:** Design decision. `CSV_HEURISTIC_THRESHOLD = 0.8` for ≥10 rows; 100% required for <10 rows. Edge cases noted in plan text are correct: Antarctica (lat ~ -90), dateline (lng ~ ±180) — both within valid range bounds so the range check passes correctly. No external citation needed.

---

## Q7 — `_addressColumn` public API versioning

**Resolution:** Design decision. Make it public and version it as `_addressColumn_v1`. Rationale: Phase 6 adds geocoding; if the field name changes then, every Phase 3 file needs migration. A versioned name (`_v1` suffix) lets Phase 6 add `_addressColumn_v2` with a new semantics contract while old files stay readable. No external citation needed.

---

## Library Health Check (outside Q1–Q7, within mandate: "edit tasks if approach changes")

### `shpjs` (plan uses `^4.0`)
- npm page: https://www.npmjs.com/package/shpjs
- Current version: **6.2.0**, published **7 months ago** (as of 2026-05-03)
- 114 dependents, 48 versions, actively maintained
- TypeScript types available via `@types/shpjs`
- **Status: healthy, active.** Plan's task using `shpjs` stands. Note: plan specifies `^4.0` but current is `6.2.0` — update version pin to `^6.2` in Task 7.

### `togeojson` (plan uses `^0.16`)
- npm page: https://www.npmjs.com/package/togeojson
- **DEPRECATED** — npm deprecation notice: "This module has moved: please install `@mapbox/togeojson` instead"
- `togeojson` v0.16.0 published 10 years ago; no active maintenance
- Successor: `@mapbox/togeojson` — v0.16.2, published 3 years ago, 55 dependents, same API
- **Status: must switch.** Task 13 (`kml.ts`, `gpx.ts`) must use `@mapbox/togeojson` instead of `togeojson`. API is identical (`toGeoJSON.kml(doc)` / `toGeoJSON.gpx(doc)`), import path changes only.

---

## Summary of Task Edits Required

| Task | Change |
|---|---|
| Task 7 (shapefile.ts) | Update `shpjs` version pin from `^4.0` to `^6.2` in package.json mention |
| Task 13 (kml.ts, gpx.ts) | Replace `togeojson` with `@mapbox/togeojson` throughout |
| Tech Stack Additions table | Update `togeojson` row to `@mapbox/togeojson ^0.16.2` |
