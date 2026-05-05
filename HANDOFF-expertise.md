# Project Expertise (via Mulch)

## meta (37 records, updated just now)
- [decision] brainstorming: REVIEW:skill-removed: status=ORPHANED xrefs=OK(7evals) value=REVIEW:skill-removed (mx-bb6e4f)
- [decision] dispatching-parallel-agents: REVIEW:skill-removed: status=ORPHANED xrefs=OK(5evals) value=REVIEW:skill-removed (mx-2d550d)
- [decision] executing-plans: REVIEW:skill-removed: status=ORPHANED xrefs=OK(18evals) value=REVIEW:skill-removed (mx-951339)
- [decision] receiving-code-review: REVIEW:skill-removed: status=ORPHANED xrefs=OK(0evals) value=REVIEW:skill-removed (mx-c88df1)
- [decision] systematic-debugging: REVIEW:skill-removed: status=ORPHANED xrefs=OK(0evals) value=REVIEW:skill-removed (mx-d5fa05)
- [decision] test-driven-development: REVIEW:skill-removed: status=ORPHANED xrefs=STALE(simplify) value=REVIEW:skill-removed (mx-545821)
- [decision] verification-before-completion: REVIEW:skill-removed: status=ORPHANED xrefs=OK(0evals) value=REVIEW:skill-removed (mx-b64124)
- [decision] writing-plans: REVIEW:skill-removed: status=ORPHANED xrefs=OK(10evals) value=REVIEW:skill-removed (mx-9ca4d1)
- [decision] writing-skills: REVIEW:skill-removed: status=ORPHANED xrefs=OK(0evals) value=REVIEW:skill-removed (mx-e64ebb)
- [decision] file:skill-creator/scripts/improve_description.py: REVIEW:may-be-redundant: status=DRIFTED:adopted(24) xrefs=N/A value=REVIEW:may-be-redundant (mx-0a2fee)
- [decision] file:skill-creator/scripts/run_loop.py: REVIEW:may-be-redundant: status=DRIFTED:adopted(40) xrefs=N/A value=REVIEW:may-be-redundant (mx-2d5aff)
- [convention] Cross-worker dep additions must serialize, not parallelize — when two parallel workers both add depe... (mx-372bdb)
- [convention] Serialize auditor after actor — when an actor (builder/demo agent) modifies install state, the audit... (mx-537ae1)
- [convention] File triage seeds mid-session as findings surface, not deferred to handoff prose — each blocker gets... (mx-a174c9)
- [convention] correction: first handoff attempt was incomplete — did not dispatch record-extractor and skipped som... (mx-391d6f)
- [convention] Always use absolute paths in Bash tool calls — shell cwd persists across Bash calls in agent threads... (mx-0d9feb)
- [convention] Peer-vs-parent discriminator for wave task assignment: when deferring missing work into an existing ... (mx-537417)
- [decision] Stage transition in brainstorm-to-ship: plan → execute: Advanced from plan to execute (mx-06df3c)
- [decision] classifyTool('selection')=false — selection is map pass-through for Phase 1: isDrawingMode = !['hand','selection'].includes(activeTool.type). (mx-d75e98)
- [convention] correction: plan literals diverge from codebase — pre-state divergences in subagent briefs before di... (mx-e9dc63)
- [decision] skip atlas-app vitest scaffolding for Phase 1 — visual demo + typecheck + build is sufficient: Plan Tasks 11/12/13 Step 5 specified component-level characterization tests for atlas-app. (mx-46c2d8)
- [convention] Subagent workers reliably hand-wave verification failures as 'out of scope' or 'pre-existing baselin... (mx-2ad5f6)
- [convention] Two pre-dispatch artifacts cut Worker brief failure rate sharply: (1) PRE-SPIKE — when the plan name... (mx-7ef9cf) [relates to: mx-372bdb, mx-537ae1]
- [convention] Plan literals go stale within 24h of authoring when a parallel wave ships — Phase 2 plan was authore... (mx-d9ab91)
- [convention] When plan claims to 'extend interface with X+Y', grep current types.ts first — X or Y may already be... (mx-ce5d92)
- [decision] plan-change: Wave 0 collapsed from 2-worker parallel dispatch to 1-inline task (T01 only): Original plan: Wave 0 = T01 (types contract) + T02 (audit housekeeping) as parallel workers. (mx-7ad911)
- [convention] Types-only files land before any consumer task — T01 pattern: when multiple downstream tasks (T11/T1... (mx-364d3c)
- [convention] opus-audit-post-wave4 document is the canonical Phase 2 pre-dispatch audit, following the same templ... (mx-6eac5e)
- [convention] correction: plan literals omit src/ path segment — every atlasdraw package (tools, data, geo, basema... (mx-8ec7b9)
- [convention] pre-dispatch scrub catches integration-seam absence, not just plan-literal drift — Wave 1 scrub foun... (mx-d4f376)
- [convention] clarification: triage skill verdict shape for bucket-A holds — removing needs-triage label without c... (mx-3422c1)
- [convention] advisor catches what regex extracts miss — first scrub draft called T05 and T08 clean based on regex... (mx-d3616b)
- [convention] Barrel export as stub signal — when a package's barrel (index.ts) has not been touched by any consum... (mx-9caad1)
- [convention] correction: plan literals reference phantom files — beyond src/ path segment omission (mx-8ec7b9), W... (mx-619182)
- [decision] wave-N absorption: absorb phase residue into single hardening sprint rather than fragmenting per phase: When a phase is declared done but leaves gating residue (unfinished tasks, unmet acceptance criteria... (mx-7857de)
- [convention] correction: plan-literal drift is recursive — the mx-e9dc63 lesson does not inoculate even the plan-... (mx-04ac8d)
- [convention] Test file placement is partial-by-package, not project-wide: geo pkg (code/packages/geo/src/) uses C... (mx-e9408d) [relates to: mx-e9dc63]

## Quick Reference

- `mulch search "query"` — find relevant records before implementing
- `mulch prime --files src/foo.ts` — load records for specific files
- `mulch prime --context` — load records for git-changed files
- `mulch record <domain> --type <type> --description "..."`
  - Types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
  - Evidence: `--evidence-commit <sha>`, `--evidence-bead <id>`
- `mulch doctor` — check record health

... and 21 more records across 1 domain (use --budget <n> to show more)

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. mulch learn              # see what files changed — decide what to record
[ ] 2. mulch record <domain> --type <type> --description "..."
[ ] 3. mulch sync               # validate, stage, and commit .mulch/ changes
```

**NEVER skip this.** Unrecorded learnings are lost for the next session.
