<!-- ADR-0016-MARKER: sdk-removed-cli-deferred -->

# ADR-0016: Delete the SDK Stub; Decide the CLI After the Format Settles

- **Status:** Accepted. Point 1 is done. Point 2 is due: see "State (2026-10-01)".
- **Date:** 2026-10-01
- **Relates to:** ADR-0015 (world coordinates), `code/decisions/0002-license-split.md`

## Context

`packages/sdk` is `export const __PHASE_0_STUB__ = true`. Nothing imports it.
Phase 6 cut the embed SDK (ADR-0011 context, Q-P6-1). `code/LICENSING.md` and
the READMEs still describe an MIT embed SDK that users can `npm install`.

`packages/cli` has `convert` and `lint` commands but no consumers, and its
`bin` cannot be built. The README lists a `render` command that does not exist.
Its value depends on the file format, which ADR-0015 may change.

## Decision

1. **Delete `packages/sdk`.** Remove its rows from `code/LICENSING.md`,
   `README.md` and `code/README.md`, and its mention in `code/CLAUDE.md`. Embedding
   is served by the `/embed` route; a future scriptable embed API is a new
   decision.
2. **Keep `packages/cli` frozen until the format settles.** No new commands.
   After ADR-0015's outcome and the W3 document changes, either make the `bin`
   build and test `convert` and `lint` against v2 files, or delete the package.
   Remove the `render` claim from the README now.

## Consequences

The licence split loses a package that never existed in practice. The CLI
stops being advertised for things it cannot do.

## State (2026-10-01)

- `packages/sdk` is deleted, and its rows are gone from `code/LICENSING.md`
  and the READMEs.
- The CLI README no longer advertises `render`.
- The format has settled: manifest version 2 with world coordinates (W3, W4;
  ADR-0015). The trigger for point 2 has fired, and the choice is not made.
  `packages/cli` still has no build (`"build"` is a TODO), and `convert`
  writes the current version.

