# ADR 0001: Fork vs Package

**Status:** Accepted  
**Date:** 2026-05-03

## Context

Atlasdraw must integrate MapLibre with Excalidraw's canvas to enable geographic annotation on interactive maps. Three integration strategies are available:

1. **Package approach** — Install @excalidraw/excalidraw via npm and configure via props
2. **Git submodule** — Vendor Excalidraw as a git submodule and apply local patches
3. **Full fork** — Create an independent fork with merged patches, customized scene format, and swapped backends

The choice determines the integration depth, maintenance burden, and long-term flexibility.

## Decision

Adopt a **full fork** of Excalidraw. 

Rationale: Atlasdraw requires modifications that exceed Excalidraw's prop surface:

- **Scene format extension** — Add `customData.geo` field to ExcalidrawElement for geographic anchoring
- **Coordinate space retooling** — Adapt hit-testing and rendering for tilted Mercator projections and map-aware zoom levels
- **Rendering overrides** — Adjust hand-drawn roughness and stroke behavior at geographic zoom scales
- **Collab backend swap** — Replace Excalidraw's room and storage model with Atlasdraw's Yjs + Socket.IO architecture

These changes are incompatible with the public @excalidraw/excalidraw API and cannot be layered via wrapper components.

## Consequences

### Positive
- Full control over scene format and rendering pipeline
- Seamless integration with geographic data model
- No abstraction friction between Excalidraw internals and map layer

### Negative / Risks
- **Merge tax** — Must reconcile ~50–100 commits monthly from upstream/master
- **Divergence risk** — Custom patches may conflict with upstream improvements
- **Update burden** — Critical security fixes in Excalidraw require proactive patching

**Mitigation:**
- ADR 0004 establishes a formal monthly merge policy with clear exit conditions
- `decisions/upstream-patches.md` documents all custom patches for review during merges
- CI guard prevents merges of Excalidraw files without corresponding patch documentation

## References

- atlasdraw-tech-spec.md §1 (integration architecture)
- open-questions-resolution.md Q6 (fork vs package decision)
- decisions/0004-upstream-merge-policy.md
