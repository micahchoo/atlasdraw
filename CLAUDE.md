# Atlasdraw

The product lives in `code/`, a Yarn 4 workspace. Run every `yarn` command
from there. `code/CLAUDE.md` holds the layout, commands and package rules, and
loads when you work under `code/`.

ADRs live in two series whose numbers collide: `code/decisions/` (0001–0010,
the fork and licence decisions) and `docs/architecture/adr/` (0006 and later,
the product decisions). "ADR 0010" can mean own-the-fork or the Yjs E2EE
threat model, so cite an ADR by file path.

User docs say what the code does now. History goes in `CHANGELOG.md` and the
ADRs only. An ADR that a later one reverses keeps its text and gets a dated
note at the top.

Open follow-up work is in `.agents/docs/SHEET_PANEL_FOLLOWUPS.md`.
`ISSUES.md`, `DEADWOOD.md` and every `docs/superpowers/plans/` are deleted;
`git log` holds them. The research notes in `code/decisions/` still cite those
plans, as history.

## Scoped rules

`.claude/rules/*.md` hold path-scoped knowledge. A rule's `paths:` frontmatter
(a glob list) decides when it loads; a rule without `paths:` loads in every
session. Narrower paths win a conflict.

Write a rule when you learn something a reader of the file cannot see: a
contract with consumers elsewhere, a security boundary, a migration in
progress, a measured hazard. Give it `paths:` for the narrowest directory that
holds every affected file, and `source: hand-written`. Delete a rule whose
paths no longer match any file.
