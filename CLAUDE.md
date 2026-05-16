## Scoped Rules

This project has `.claude/rules/` — file-scoped rules with YAML frontmatter
(`scope`, `tags`, `priority`, `source`) injected automatically when editing matching files.

**Using rules:**
- Rules matching your current file appear as context guidance. Follow them like CLAUDE.md instructions.
- When rules conflict, narrower scope wins. If genuinely ambiguous, ask.

**Growing rules — when you discover path-scoped knowledge:**
- Architectural contracts: "changes to this interface require updating consumers X, Y"
- Security boundaries: "this module handles PII — never log arguments"
- Migration state: "new code uses pattern B, don't extend pattern A"
- Coupling warnings: "these modules share state through X — change one, check the other"
- Known hazards: "last 3 bugs here were caused by X — always check Y"
- Data invariants: "field Z is always lowercase in DB — normalize before comparison"
- Performance constraints: "hot path — no allocations, no async"
- Stability tiers: "public API — never remove fields" vs "internal — change freely"
- Negative rules: "never import from X in Y — boundary is load-bearing"

Write a rule file: `scope` to the relevant paths, `source: hand-written`, `priority`
based on how strict it is. Scope to the narrowest directory containing all affected files.
Match the rule's domain, not an arbitrary directory.

**Pruning rules:**
- When a rule's scope no longer matches any files (directory renamed/deleted), delete it.
- When a `source: scaffold` rule is wrong for the project, fix it or delete it.
- When a machine-generated rule contradicts a hand-written one, the hand-written one wins.
  Delete the machine-generated one or narrow its scope.

**Never do:**
- Don't put rules in `~/.claude/` — rules are project-local, always.
- Don't create rules for things already enforced by linters/formatters — redundant.
- Don't create project-wide rules for file-specific concerns — scope them.
- Don't duplicate CLAUDE.md content into rules — rules express what CLAUDE.md can't.

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
