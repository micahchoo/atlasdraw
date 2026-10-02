# bench

Parse timings for `@atlasdraw/data`, and a gate that compares two versions of that code on one machine.

## Run it

```bash
yarn workspace @atlasdraw/bench bench          # one run: results/current/parse.json
yarn workspace @atlasdraw/bench ab --base <other checkout>/code --runs 5
```

`ab` times the other checkout (the "base") and this one (the "head"). The base checkout must have its own `node_modules` (`yarn install`).

## How the gate decides

1. Each run times four scenarios (`scenarios/parse.test.ts`): 20 iterations after 3 warm-up iterations. A run records the median of each scenario.
2. `ab.ts` does N rounds. Each round runs the base and the head once, in alternating order, so a runner that slows down during the job slows both sides alike.
3. One harness times both sides. `BENCH_DATA_SRC` points `@atlasdraw/data` at the base's source; the scenarios and the fixtures are the head's.
4. `gate.ts#compareRuns` takes, per scenario, the median of the N run medians on each side. The head fails when it is slower than `base x (1 + max(10%, 3 x spread))`. The spread is the relative median absolute deviation of the runs, so noisy runs widen the limit.

The previous gate compared one run against a baseline committed from a developer's machine. It failed 2 runs in 3 on an unchanged tree (audit 2, F4). There is no committed baseline now.

## Measured on a developer machine, 2026-10-01

- The same code on both sides (A/A), 5 runs each, 5 times: 5 of 5 pass (20 of 20 scenario checks). The largest head/base ratio was 1.10; the limit in that run was 1.31.
- A head made 30% slower: 3 of 4 scenarios fail. The fourth was noisy and its limit widened to 28%.
- One `ab` with 5 runs takes about 25 s.

## Decision: report only

CI runs `ab` on every pull request and push, and writes the table to the job summary. The job does not block a merge.

Make it blocking (pass `--blocking` in `.github/workflows/ci.yml`) only when 5 consecutive CI runs on unchanged parse code all pass. A GitHub runner is a shared virtual machine; the local result does not prove that the runner is quiet enough. If one of the 5 fails, keep it report only and record the spread in this file.
