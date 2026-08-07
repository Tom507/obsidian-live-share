// WP23 / AC4 — "the op registry is open for extension so later phases can add
// ops WITHOUT MODIFYING THE FUZZER CORE, and every WP in this spec that changes
// merge or serialisation behaviour is reachable through at least one registered
// op."
//
// Both halves are checked mechanically, because both are the kind of claim that
// decays silently:
//
//   ├── EXTENSION — a brand-new op class, defined entirely inside this test
//   │      file, is registered and then actually drawn and run by the core. The
//   │      core imports `OpRegistry` as a TYPE and takes `bootstrap` as a
//   │      callback; it contains no op name and no `switch`. If a later phase
//   │      ever had to edit `fuzzer.ts` to add an op, this test is where that
//   │      shows up.
//   └── COVERAGE — every WP the initial registry claims to reach is declared per
//          op in `reaches`, and the union is asserted against the required set.
//          Deleting an op class now breaks a test instead of quietly shrinking
//          what the fuzzer covers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUZZ_TEST_TIMEOUT_MS, describeResult, runFuzzScenario } from "../../harness/fuzz/fuzzer";
import type { OpContext, OpDefinition } from "../../harness/fuzz/op-registry";
import {
  REQUIRED_WP_COVERAGE,
  bootstrapStandardWorld,
  createStandardRegistry,
} from "../../harness/fuzz/standard-ops";

const SEED = 0x23_0006;

/**
 * A "later phase" op class, written here and nowhere else. It colours a surface
 * node — a field the standard registry never touches — through a direct doc
 * write, and logs its intent into the same trace the oracle reads.
 */
function makeLaterPhaseOp(ran: { count: number }): OpDefinition {
  return {
    name: "laterPhaseColourOp",
    weight: 50,
    reaches: ["WP99"],
    applicable: (ctx: OpContext) => ctx.trace.allRecords("node").length > 0,
    run(ctx: OpContext) {
      const target = ctx.rng.pick(
        ctx.trace.allRecords("node").filter((record) => record.visible && !record.invalid),
      );
      if (!target) return false;
      const slot = { kind: "node" as const, id: target.id, field: "color" };
      if (!ctx.claims.claim(slot)) return false;
      const record = ctx.replica.nodes().get(target.id);
      if (!record) return false;
      const colour = String(1 + ctx.rng.int(6));
      ctx.replica.doc.transact(() => record.set("color", colour));
      ctx.trace.write({
        window: ctx.window,
        replica: ctx.replica.index,
        opClass: "laterPhaseColourOp",
        slot,
        value: colour,
        contested: false,
      });
      ran.count += 1;
      return true;
    },
  };
}

describe("WP23 AC4 — the op registry is open for extension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a new op class defined outside the harness is drawn, run and judged by the oracle", async () => {
    const ran = { count: 0 };
    const registry = createStandardRegistry().register(makeLaterPhaseOp(ran));

    const result = await runFuzzScenario({
      seed: SEED,
      windows: 6,
      registry,
      bootstrap: bootstrapStandardWorld,
      flushTimers: () => vi.runOnlyPendingTimers(),
    });

    expect(ran.count, "the registered op class was never run").toBeGreaterThan(0);
    expect(result.opsUsed, "the core did not report the new op class as exercised").toContain(
      "laterPhaseColourOp",
    );
    expect(result.violations, describeResult(result)).toEqual([]);
    // The oracle judged the new op's field on its own terms — no core change.
    expect(
      result.trace.log.some((entry) => entry.opClass === "laterPhaseColourOp"),
      "the new op's intent never reached the trace the oracle reads",
    ).toBe(true);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("registering a duplicate op name is refused rather than silently shadowing", () => {
    const registry = createStandardRegistry();
    const duplicate = { ...(registry.list()[0] as OpDefinition) };
    expect(() => registry.register(duplicate)).toThrow(/duplicate op class/);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("every WP that changes merge or serialisation behaviour is reachable", () => {
    const coverage = createStandardRegistry().coverage();
    const missing = REQUIRED_WP_COVERAGE.filter((wp) => !coverage.has(wp));
    expect(
      missing,
      `no registered op class reaches ${missing.join(", ")} — AC4's second half is not satisfied`,
    ).toEqual([]);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("a focused subset runs without the core learning anything about it", async () => {
    const registry = createStandardRegistry().subset([
      "moveViaSave",
      "resizeViaSave",
      "dualSpellingWrite",
    ]);
    expect(registry.list().map((definition) => definition.name)).toEqual([
      "moveViaSave",
      "resizeViaSave",
      "dualSpellingWrite",
    ]);
    const result = await runFuzzScenario({
      seed: SEED + 1,
      windows: 5,
      registry,
      bootstrap: bootstrapStandardWorld,
      flushTimers: () => vi.runOnlyPendingTimers(),
    });
    expect(result.violations, describeResult(result)).toEqual([]);
    expect(result.opsApplied, "the focused subset applied nothing at all").toBeGreaterThan(0);
  }, FUZZ_TEST_TIMEOUT_MS);

  it("every op class declares what it reaches, and says plainly where a mechanism is absent", () => {
    for (const definition of createStandardRegistry().list()) {
      expect(
        definition.reaches.length,
        `op class "${definition.name}" declares no WP coverage`,
      ).toBeGreaterThan(0);
    }
    // Two op classes stand in for mechanisms that DO NOT EXIST YET (WP36's
    // collaborative text, WP38's undo). Saying so in the registry is the
    // difference between a documented gap and a faked capability.
    const registry = createStandardRegistry();
    expect(registry.get("relabelViaSave")?.note, "the WP36 gap is not stated").toMatch(/WP36/);
    expect(registry.get("undoDelete")?.note, "the WP38 gap is not stated").toMatch(/WP38/);
  }, FUZZ_TEST_TIMEOUT_MS);
});
