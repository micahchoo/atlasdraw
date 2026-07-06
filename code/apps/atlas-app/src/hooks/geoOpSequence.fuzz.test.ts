/**
 * Sequence fuzzer for the drawing↔map interaction layer.
 * Phase 2b of `.claude/skills/geo-op-idempotency-hunt` — see the harness
 * header for the world model and its documented approximations.
 *
 * Contract: failure signatures listed in KNOWN_FAILURES are open, triaged
 * bugs (each must reference a repro test or issue). Any signature NOT in the
 * list fails this suite — that's the fuzzer finding a NEW bug class. Fixing
 * a bug means removing its signature here and watching the suite stay green.
 */
import { describe, it, expect } from "vitest";

import {
  generateSequence,
  runSequence,
  shrinkSequence,
  type Op,
} from "./geoOpFuzz.harness";

const SEED_COUNT = 500;

/**
 * signature = invariant | opType | anchorKind | scaleMode
 * Populated only after a failure is minimized, understood, and triaged.
 */
// Classes A-F were fixed by the 2026-07-05 protocol overhaul (regression
// repros in geoOpKnownHazards.repro.test.ts). New entries require: minimized
// `it.fails` repro there + a seeds issue + a class comment here.
const KNOWN_FAILURES = new Map<string, string>([
  // Class G — world-wrap at the ±180 seam: renderWorldCopies is false and
  // minZoom is unset (default 0), so geometry can sit past the world edge;
  // normalizeLng wraps those anchors to the far side and projection jumps
  // by a world width. Fix is a world-edge policy decision, not a protocol
  // patch. Repros: geoOpKnownHazards G-*. Issue: atlasdraw (class G).
  ["NEUTRAL-VIS|create|point|geographic", "G"],
  ["NEUTRAL-VIS|resize|polyline|geographic", "G"],
]);

function fmt(ops: Op[]): string {
  return ops.map((o) => JSON.stringify(o)).join("\n    ");
}

describe("geo-op sequence fuzzer", () => {
  it(`finds no unknown failure classes across ${SEED_COUNT} random sequences`, () => {
    const bySignature = new Map<
      string,
      { seed: number; ops: Op[]; message: string; count: number }
    >();

    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const { ops, init } = generateSequence(seed);
      const { violation } = runSequence(ops, init);
      if (!violation) {
        continue;
      }
      const shrunk = shrinkSequence(ops, init, violation.invariant);
      const sig = shrunk.violation.signature;
      const existing = bySignature.get(sig);
      if (existing) {
        existing.count++;
      } else {
        bySignature.set(sig, {
          seed,
          ops: shrunk.ops,
          message: shrunk.violation.message,
          count: 1,
        });
      }
    }

    const unknown = [...bySignature.entries()].filter(
      ([sig]) => !KNOWN_FAILURES.has(sig),
    );

    const report = unknown
      .map(
        ([sig, f]) =>
          `\n  UNKNOWN ${sig}  (seen ${f.count}x, first seed ${f.seed})\n` +
          `  ${f.message}\n  minimal sequence:\n    ${fmt(f.ops)}`,
      )
      .join("\n");

    expect(
      unknown.map(([sig]) => sig),
      report,
    ).toEqual([]);
  });

  it("harness sanity: create → zoom → pan → zoom back is clean on a rect", () => {
    const init = { zoom: 10, center: { lng: -122.4, lat: 37.77 } };
    const ops: Op[] = [
      { t: "create", kind: "rect", px: 400, py: 300, w: 120, h: 80 },
      { t: "zoom", dz: 2 },
      { t: "pan", dx: 150, dy: -80 },
      { t: "zoom", dz: -2 },
    ];
    const { violation } = runSequence(ops, init);
    expect(violation?.message ?? null).toBeNull();
  });
});
