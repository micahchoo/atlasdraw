# HARVEST — session lessons

One dated section per tend session. Row: lesson | general rule | stored where.

## 2026-07-05 — Issue 4 deletion sweep

| lesson | general rule | stored where |
|---|---|---|
| `vitest run \| tail -3` reported "pass" for a failing suite — the pipeline's exit code is tail's, not vitest's; the first index.ts deletion was committed on an unverified green | Never gate a commit on a piped test command. Capture the runner's own exit code (`cmd > log 2>&1; status=$?`) and grep the log separately. | project memory `pipeline-exit-codes-mask-test-failures.md`; DEADWOOD.md run notes |
| A concurrent agent session (Issue 3 journey walk) shared this checkout: its `commit -a` swept my staged files (reverting a deletion), its half-landed edits produced 18 phantom test failures, and its commits landed on my branch | Before and during any test-gated or destructive loop, check tree quiescence (`git log -1 --format=%cd`, `git status` churn between runs). If another session is active, move the work to `git worktree` — symlinking `node_modules` makes the suite runnable there in seconds. | project memory `concurrent-sessions-shared-checkout.md`; DEADWOOD.md run notes |
| Basename-grep deadness tracing has three blind spots: directory imports (`from ".."` resolves to index.ts without naming it), entry points outside src (index.html → main.tsx), and package.json main/exports | A module is dead only after checking: basename imports, directory-style imports, dynamic imports/globs, entry HTML, and manifest entry fields — and after re-verifying single-hit rows are import statements, not comments. | DEADWOOD.md method note (header) |
| CursorOverlay/PresenceList are complete, never-mounted feature UI — deleting them would have destroyed shippable Phase 5 work | Feature-shaped dead code is a capability-reach row, not a deletion row: verdict before delete. (Already encoded in the deletion-sweep pattern; this run confirmed why.) | DEADWOOD.md verdict rows |
| An 18-test failure storm correlated perfectly with a file deletion — and the correlation was spurious (the tree was mutating between runs) | When a deterministic-looking failure has no mechanism after two honest attempts, stop hypothesizing and check whether the world is changing under you (concurrent writers, caches, clock) before debugging the code. | project memory `concurrent-sessions-shared-checkout.md` |
