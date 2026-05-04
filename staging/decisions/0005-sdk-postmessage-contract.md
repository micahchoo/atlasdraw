# ADR 0005: SDK postMessage Contract

**Status:** Proposed (finalized in Phase 6)  
**Date:** 2026-05-03

## Context

Phase 7 introduces a plugin sandbox: plugins run in Web Workers and communicate with the main app via postMessage. Phase 6 publishes a stable AtlasdrawAPI surface for embed and plugin authors.

If the v1 API is not postMessage-safe (i.e., contains non-serializable types), retrofitting the v1.5 plugin sandbox breaks all published plugins.

## Decision

**Proposed contract (finalized Phase 6):**

All public AtlasdrawAPI methods must be:
1. Async or fire-and-forget (no synchronous blocking)
2. Argument and return values must be JSON/structured-clone-compatible
3. No DOM nodes, class instances, or function objects in signatures
4. CI test gate: every public method passes structured-clone round-trip on arguments and return values

**Known incompatibility:** MapLibre `LngLat` class instances silently strip methods during structured clone (per Phase 6 OQ2 finding). Solution: convert to `{lng: number, lat: number}` objects at API boundary.

## Consequences

### Positive
- Enables plugin sandbox without breaking existing plugins
- API is inherently portable to Web Workers and iframe sandboxes
- Catches serialization bugs early in v1

### Negative / Risks
- **Delayed finalization** — Contract written in Phase 6, not now
- **Breaking changes possible** — Phase 6 may discover incompatibilities requiring v1 API revision
- **Type complexity** — Structured-clone requirements may constrain API design

**Mitigation:**
- Phase 1–5 is implementation; Phase 6 finalizes contract
- Provisional stub of postMessage wrapper in Phase 1 (disabled until Phase 6)
- Early type audit in Phase 5 Task 15 to flag incompatibilities

## References

- open-questions-resolution.md Q11 (postMessage design)
- Phase 6 plan (API finalization)
- Phase 7 plan (plugin sandbox)
