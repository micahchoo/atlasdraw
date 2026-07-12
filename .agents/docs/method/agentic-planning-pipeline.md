# Agentic Planning Pipeline — Methodology Notes

**Status:** descriptive. Distilled from observation of one project's planning artifacts; written as a reusable pattern, not a recipe.

**What this document is:** a layered description of an upfront-waterfall + agentic-parallel-execution planning method. Each layer names its purpose, the artifact it produces, and the structural property that makes it load-bearing.

**Audience:** anyone deciding how to plan multi-phase work that will be executed (in part) by sub-agents and would survive a cold handoff.

---

## 1. The shape

Waterfall on the outside, agentic-parallel on the inside, with a meta-loop on the seam.

- **Outside (waterfall).** The whole program is planned upfront, in one authoring sitting, before code begins. Phase plans cite each other's outputs as inputs.
- **Inside (parallel).** Each phase is decomposed into *waves*; each wave is a cohort of *tasks* dispatched concurrently to workers. Concurrency is decided at plan time, encoded in the plan.
- **On the seam (meta-loop).** A scrub gate and an audit layer absorb the inevitable drift between plan-time and dispatch-time, and feed corrections back into plans, conventions, and enforced rules.

The load-bearing trick: every artifact at every layer carries a stable identifier (`Q-N`, `T-N`, `W-N`, `E-N`, `R-N`, `MISMATCH-N`, `ADR-N`, seed IDs, mulch IDs, commit hashes). Cross-layer references compose into a fully addressable graph. Nothing load-bearing is referred to by prose alone.

---

## 2. Pre-plan stack — three ordered documents

Plans don't begin at the plan. The plan corpus sits on top of three earlier documents, in this order:

1. **Technical specification.** What the system is, what its parts are, how they interact at the lowest level we can commit to upfront. Authoritative for type shapes, protocol fields, file formats.
2. **Product requirements (PRD).** Why the system exists, who it serves, what shippable success looks like at each milestone. Lists *open questions* as the work product — debates that the spec can't yet resolve.
3. **Constrained-decisions document.** Closes the contested choices from the PRD. Each frozen decision gets a stable ID (`Q-N`) and a structured body: *Recommendation / Reason / Constraint imposed on plans*. The stated purpose is explicit: *"Lock so that downstream plans treat these as constraints, not open variables."*

This third document is the highest-leverage artifact in the entire stack. It looks like a 13-paragraph FAQ; it is the act of converting debate into constraint. Every phase plan thereafter cites Q-numbers in lieu of re-deriving the decision.

---

## 3. Plan document grammar

Phase plans share a fixed grammar. Earlier phases use a short template; later phases back-import new sections as the team discovers which gates were load-bearing. The plan-of-plans is itself a longitudinal record.

A mature plan has roughly these sections:

| § | Section | What lives here |
|---|---|---|
| 1 | Header | Goal, calendar window, owner |
| 2 | Phase Boundary Contracts | What this phase produces; what it consumes from prior phases (one row per typed interface) |
| 2b | Pre-Work Checklist / Readiness Gates | Mechanically checkable preconditions before any task dispatches; each row is `Gate / Check (shell command) / Blocking task if absent` |
| 3 | Flow Map Preamble | Named runtime flows (`Flow A`, `Flow B`) with ASCII arrow diagrams + one-line invariants |
| 4 | File Structure | Every file labeled `[NEW]` or `[MOD]` with a one-line responsibility |
| 5 | Tasks | Atomic dispatch units, each with a fixed inner anatomy (see §4) |
| 6 | Execution Waves | ASCII column diagram of task → wave assignment, `SERIAL GATES:` list, parallelizable-pairs reasoning |
| 7 | Open Questions | Plan-time unknowns; each is back-edited inline with `> RESOLVED (date):` blocks |
| 8 | Artifact Manifest | Table of produced artifacts (Path / Type / Status / Produced by). Wrapped in machine-findable markers (e.g. `<!--MANIFEST:START-->`) |
| 9 | Q-Reference Summary | Table of `Decision ID → applied where in this plan` — every constraint citation enumerated |
| 10 | Shape Changes Summary | Audit log of edits to *this plan document*, attributed by named role + date + finding ID |

The grammar's load-bearing property is that *every section is addressable by stable ID*: the manifest names artifacts, the Q-summary names citations, the shape-changes log names amendments, and the audit incorporation sub-table names which audit finding caused which amendment.

---

## 4. Task anatomy

Tasks are not bullet points. Each task is a mini-contract with a fixed shape:

- **Orient:** one paragraph of context — *what this task is for, and why now*.
- **Flow position:** which numbered step of which named flow this is.
- **Upstream contract:** what this task expects to receive (from prior tasks or prior phases).
- **Downstream contract:** what it must produce for downstream tasks.
- **Skill:** named skill or `none`.
- **Files:** typed change list — `Create`, `Modify`, `Delete`, each path explicit.
- **Steps:** numbered, each with `Run:` (concrete command) + `Expected:` (acceptance criterion).
- **Optional checkboxes** on each step so progress is trackable in place.

The format is dual-purpose: it reads as instruction for a human reviewer *and* as a brief for a worker agent. The `Run/Expected` pair is the testable boundary between "the worker did the work" and "the work succeeded."

---

## 5. Wave anatomy

A wave is a *concurrency declaration*, not just a grouping. The execution-waves section renders as an ASCII column diagram with one column per wave, plus three machine-readable annotations:

1. **`SERIAL GATES:`** — explicit dependency edges between waves ("Wave 2 must complete before Wave 3 starts because …").
2. **Parallelizable pairs (no file conflicts):** — enumeration of which intra-wave tasks may run simultaneously without contention, with the rationale.
3. **Wave-internal serialization arms:** — when two tasks edit the same file but different switch arms, the plan declares them serial within the file, parallel for review/test.

Concurrency is decided at plan time. The worker doesn't decide whether to parallelize; the plan tells it.

---

## 6. Per-phase research stage

Before each plan is finalized, an *open-questions-resolver* agent answers phase-local unknowns. Each entry is structured:

```
Q-PN-N — <one-line question>
  Queries run: <commands + sources>
  Sources: <URLs / files / dates>
  Answer: <claim>
  Confidence: <high / med / low + brief reason>
```

The answers are *back-edited into the plan body* (inline `> RESOLVED (date):` blocks) when they invalidate prior plan text. Plans are not frozen; they are living documents that accumulate truth.

---

## 7. Cross-plan reconciliation audit

After plans are drafted, a separate auditor agent runs a producer/consumer contract check across *all* plans. Output: a numbered list of `MISMATCH-N` findings — places where what Phase A produces and Phase B claims to consume don't match. Two-options + recommendation + gate condition format, identical to the escalation register.

Typical mismatches: type shape drift (same type described three different ways across phases), source-path drift (Phase 3 says `LayerRegistry` lives in package X, Phase 2 produces it in package Y), field name drift (`customData.foo` vs `customData.fooAnchor`).

The audit is the only line of defense between plan-time and code-time on cross-plan semantic drift. Without it, the workers reading their slice of the plan would each see something self-consistent and produce contradicting code.

---

## 8. Speculative architecture layer

Parallel to the plans, a separate architecture corpus describes the system *as if it existed*. Every document is labeled **"Status: Speculative — revise against real code"** in its header.

The corpus has four parts:

- **Overview / domain / ecosystem.** What the system is and what it's embedded in.
- **Evolution.** Phase-by-phase predicted architectural shape; named *eras* with markers ("when X lands, the trust boundary shifts").
- **Per-subsystem `contracts.md`.** One per package/service, describing the public surface (types, events, CLI shape, REST routes). These are the interface specs that plans cite.
- **Cross-cutting concerns.** Five fixed dimensions broken out: `conventions`, `data-flow`, `patterns`, `quality`, `security`. Cross-cutting concerns are surfaced, not hidden.

Each claim carries a `[CONFIDENCE: high | med | low]` label and a `Source:` citation. The architecture is treated as authoritative interface spec by the plans; when code lands, reconciliation between contracts and reality becomes its own line item.

---

## 9. Risk + escalation registers

Two parallel numbered streams sit alongside the plans:

- **Risk map (`R-N`).** Forecasted technical/legal/operational risks, each tied to a phase and (where applicable) an escalation ID. Severity-graded. Mitigation noted. Residual risk noted.
- **Escalations (`E-N`).** Decisions surfaced *during plan research* (not pre-plan) that require maintainer authority. Each carries: finding → 2- or 3-options table with scope impact per option → recommendation → **gate condition** (checkbox list closed by maintainer decision).

Cross-references run both ways: a risk row can name its escalation; an escalation can name the tasks blocked behind it. Phase plans can mark a task as "may proceed assuming Option A/C until `E-N` is formally closed."

The split between `Q-N` (frozen pre-plan, by design) and `E-N` (emergent, by discovery) is critical. They serve different governance models and have different lifecycles.

---

## 10. Pre-dispatch scrub ritual

The named gate between plan-as-written and worker-dispatch. Every wave gets its own scrub document, dated, that compares the plan against the live tree and hunts four classes of drift:

1. **Path drift.** Named files don't exist at the claimed path.
2. **API-existence drift.** Named methods/props/types don't exist on the pinned upstream version. The plan literal would compile against documentation but not the vendored code.
3. **Integration-seam absence.** The file the plan wants to modify lacks the hook the plan assumes ("add `preserveDrawingBuffer: true`" presumes the option site exists).
4. **Structural blocker.** A gate artifact the plan references doesn't exist yet (e.g. a baseline JSON, a CI workflow file, a config schema).

Verdict format: per task, one of `DISPATCHABLE` / `DISPATCHABLE with corrected brief` / `HOLD — N structural decisions required`. The scrub doc names the corrected literal (file + line) so the worker brief is updated, not the worker's responsibility to re-discover.

Scrubs are *not optional*. The plans treat their own literals as presumed-drifting because the same project has logged this drift recurring across waves.

---

## 11. Worker dispatch — plan as cache prefix

Plans are sized and structured to act as a **shared context prefix** that gets handed to multiple workers in a wave. Each worker receives: prefix (universal) + delta (task-specific instruction). The prefix carries: project context, classification, the plan-section relevant to this wave, the scrub-corrected literals, a coupling-graph slice of the codebase neighborhood, and references to authoritative artifacts (mulch records, ADRs, contracts.md).

Cache-invalidation rules: rebuild the prefix if a worker's edits land in another worker's coupling neighborhood; do *not* rebuild for orthogonal edits. A worker failure is a prefix-level event — propagate it before launching the next wave.

---

## 12. Living-plan property

Plans are not frozen artifacts. Three named roles edit them after authoring, each appending an attributed audit block:

- **Resolver / shape-incorporator** — appends Shape Changes Summary after the open-questions resolver agent runs, citing the `Q-N` that drove each edit.
- **Audit-incorporator** — appends Audit Incorporation table after the cross-plan auditor, citing each `MISMATCH-N` finding it folded in.
- **Scrub-incorporator** — back-edits §2b Readiness Gates from each wave's scrub doc, with a header note: *"Updated YYYY-MM-DD per wave-N scrub. Original checklist contained drift [X, Y, Z]. Replaced with corrected gates."*

A plan section that gets back-edited carries provenance: who wrote it, on what date, citing which finding ID. The plan absorbs corrections without losing the audit trail.

---

## 13. Readiness gates — mechanical checks

The §2b Pre-Work Checklist is not aspirational prose. Each row is `Gate / Check (shell command that exits 0 on pass) / Blocking task if absent`. Examples (illustrative): `grep -E '...' returns hits`, `cd pkg && yarn test --run exits 0`, `ls path exits 0`. Gates that name a missing prerequisite cite a seed ID for the work item that would fill it. The seed system, the plan, and the scrub all reference each other by stable ID.

---

## 14. Fresh-eyes external audit

After a wave lands, a stronger model (different from the dispatch workers) runs a verification matrix:

- Verification commands run, by category (schema, CI, runtime, plan-doc lenses), each with PASS/FAIL/DENIED state.
- Artifact-by-artifact correctness table.
- Defects graded HIGH/MED/LOW with affected paths.
- **Audit-process findings.** The audit records *its own* failure modes ("sandbox denied tool X; re-launch with broader permissions before final sign-off"). Verification is itself auditable.

This is a different role from the cross-plan auditor (§7), which runs at plan-time on documents. The fresh-eyes audit runs at landing-time on code.

---

## 15. Convention-to-rule ratchet

Drift findings have a one-way ratchet:

1. **First discovery.** Scrub or audit finds a class of drift.
2. **Convention record.** Logged into the project's conventions store (mulch in this stack) with the rule + reason + how-to-apply.
3. **Second or third recurrence.** Promoted to a *scoped rule file* — auto-injected into the agent's context when editing matching paths. Rule content: trigger → mandatory check → why-this-rule-exists (citing prior incidents) → how-to-apply.

The ratchet runs in one direction. A recurring failure mode becomes a convention; a re-recurring convention becomes an enforced rule. Drift can never be re-discovered from scratch.

---

## 16. Session continuity — handoff documents

A separate per-session document (`HANDOFF.md`-shaped) is the resumption protocol. Its shape:

- **Goal** — the user's own words across the session.
- **Progress — completed this session, committed.** Each item: commit hash + one-line outcome.
- **Open after this session.** Bullets with `⬚` markers + seed IDs for each unfinished thread.
- **Phase task scoreboard.** Table re-stating task state with commit hashes and wave assignment.
- **Pre-push state.** Local-vs-remote diff, deploy-on-push warnings.
- **Outstanding triage / seed / mulch entries** to attend to.

The handoff is distinct from the plan. The plan is what to do; the handoff is where we are. A fresh agent reads the handoff first; it does not reconstruct from git log.

---

## 17. The stable-ID graph

A reader can reconstruct any decision by following IDs:

```
Q-N (constrained decision)
   ↓ cited by
plan §9 (Q-Reference Summary)
   ↓ produces tasks
T-N (task) → W-N (wave) → artifact in §8 Manifest
   ↓ scrubbed by
wave-N pre-dispatch scrub (catches drift, dated)
   ↓ amended into
plan §2b Readiness Gates + §10 Shape Changes Summary
   ↓ landed in code at
commit hash → recorded in handoff scoreboard
   ↓ verified by
fresh-eyes audit (cites artifact rows)
   ↓ surfaces
MISMATCH-N or E-N (escalation requiring maintainer)
   ↓ if recurring
mulch convention record → scoped rule file
```

Every arrow is materialized in some document. Provenance is attached to artifacts, not held in working memory.

---

## 18. Steps that look small but aren't — five categories

The pattern hides work in these places:

1. **Decision-density disguised as a paragraph.** A single resolution paragraph in the constrained-decisions document constrains every downstream phase. The document is short because the work is decision-density, not word-count.
2. **Empty / short artifacts that imply machinery.** A blank "patch register" file implies a CI guard that fails any PR violating it; an ADR title implies a permanent contract; a `gate.json` implies a threshold that the rest of the program is measured against.
3. **One-line tasks that fan out at specification time.** A task labeled "strip telemetry" expands into hundreds of lines once paths, vendored APIs, and legal constraints are enumerated. The plan-line is the title; the per-task anatomy is the work.
4. **Verbs that hide authority shifts.** "Maintainer selects Option A/B/C," "reviewer signs off," "label removed at triage" — single-line gate conditions that materially re-shape downstream phases.
5. **Gate criteria stated abstractly.** "Cross-browser matrix green," "benchmark within +20%," "smoke test passes" — each commits to its own infrastructure (test grid, baseline file, smoke harness) that the plan itself does not enumerate.

When evaluating whether a plan is *complete*, audit it against these five categories. The plan is incomplete iff there is text that asserts something true without naming the artifact that would make it checkable.

---

## 19. Failure modes this pattern is designed against

The pipeline is shaped by specific failure modes it has logged:

- **Plan-literal drift** — plans name APIs/paths/shapes that don't match the live tree. Caught by pre-dispatch scrub. Ratcheted into scoped rules on recurrence.
- **Cross-plan semantic drift** — same type, different shapes across phases. Caught by cross-plan reconciliation audit.
- **Hidden serial dependencies in supposedly-parallel waves** — caught by explicit `SERIAL GATES:` + parallelizable-pairs annotations.
- **Worker-failure prefix pollution** — a failed worker leaves the shared prefix invalid for the next wave. Mitigated by rebuilding the prefix on relevant edits + propagating failures before next launch.
- **Cold-handoff context loss** — fresh agent can't pick up. Mitigated by the dense session-handoff document.
- **Architecture drift from speculative spec** — speculative `contracts.md` and shipping types diverge silently. Caught by the fresh-eyes audit reconciling against real source.
- **Authority gaps** — agent dispatch reaches a decision that requires human judgment but doesn't know it. Mitigated by the explicit `E-N` escalation register with `gate condition` checkbox closure.

The pipeline is not designed against *new* failure modes; it is designed against *recurring* ones. Drift is acknowledged as inevitable; the structure is the immune response.

---

## 20. What this pattern is not

- **Not lightweight.** The minimum overhead is non-trivial: a constrained-decisions doc, a plan grammar, a scrub ritual, an issue store, an audit pass. If the work has < ~6 weeks of phase-decomposable shape, this pattern is over-built.
- **Not infallible.** The audits catch drift but cannot catch unstated assumptions. A `Q-N` that resolved the wrong question is invisible to every downstream check.
- **Not unique.** It composes: upfront waterfall planning (engineering), agentic concurrency dispatch (operations research), CI-gated drift detection (DevOps), and one-way-ratchet rule promotion (knowledge management). The novelty is the *integration*, not any one piece.
- **Not author-only.** The pattern only works if multiple agents and humans read and edit the same document, each in a named role with attribution. A single-author plan does not produce the cross-checks that make the rest of the pipeline trustworthy.

---

## Glossary of role names referenced

| Role | When it runs | Output |
|---|---|---|
| Open-questions resolver | Before plan finalize, per phase | Research notes; back-edits plan |
| Shape-incorporator | After resolver | Shape Changes Summary in plan §10 |
| Cross-plan auditor | After plans drafted | `MISMATCH-N` findings document |
| Audit-incorporator | After cross-plan audit | Audit Incorporation table in plan §10 |
| Pre-dispatch scrubber | Before each wave dispatches | Wave-N scrub doc; corrected literals |
| Worker | Per task within wave | Code changes; commit |
| Fresh-eyes auditor | After wave lands | Verification matrix + defect list |
| Record extractor | At pipeline close | Convention records; seeds for unresolved findings |
| Triage gate | On auto-created seeds | Approve / defer / discard |

Each role has a separate context. None of them holds the whole plan in their head. The documents are the shared state.
