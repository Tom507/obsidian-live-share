// WP23 — THE FUZZER CORE.
//
// This file knows about WINDOWS, PARTITIONS and SLOT CLAIMS. It does not know
// about a single op class, and that is the AC4 requirement made structural: it
// imports `OpRegistry` as a TYPE and `bootstrap` as a callback, so a later phase
// adds an op by registering it, never by editing anything here.
//
// THE RUN SHAPE, and why it is shaped this way
// --------------------------------------------
// A scenario is a sequence of WINDOWS. Each window:
//
//   1. clears the slot ledger and draws a fresh PARTITION,
//   2. issues 1..N ops from the registry on randomly chosen replicas — each op
//      must CLAIM the slots it writes, and at most one op per window may hold
//      any given slot,
//   3. delivers the resulting deltas WITHIN each partition group, reordered and
//      partly duplicated, then
//   4. heals the partition and quiesces — a full mesh exchange interleaved with
//      the debounced audit flush until nothing moves.
//
// Step 4 is what makes the intent-trace oracle possible: every op in window w+1
// is issued by a replica that has already integrated every op of window w, so
// two writes to the same slot in different windows are CAUSALLY ORDERED and
// Yjs's LWW resolves them deterministically. Step 2 is what makes them
// concurrent WITHIN a window without ever making them ambiguous — two ops in one
// window necessarily touch different slots, except where an op deliberately
// declares a contested pair (the WP21 link), which the oracle then judges by
// LWW-consistency instead of by value.
//
// Runtime discipline: the whole plugin suite must stay well-bounded, so the
// scenario count is a NAMED CONSTANT rather than a literal buried in a test —
// CI can raise it without touching a single assertion.

import { IntentTrace, SlotClaims } from "./intent-trace";
import { type FuzzViolation, checkAllFamilies, projectFile } from "./oracle";
import type { OpContext, OpDefinition, OpRegistry } from "./op-registry";
import { createRng, type FuzzRng } from "./prng";
import { type FuzzReplica, createReplica } from "./replica";
import { deliverWithinPartition, drawPartition, quiesce, stateVectorsAgree } from "./scheduler";

/**
 * THE SCENARIO BUDGET. One named constant so CI can raise it without editing a
 * test, and so the suite's contribution to the run time is a decision rather
 * than an accident.
 */
export const FUZZ_BUDGET = {
  /** Scenarios per property test. */
  scenarios: 200,
  /** Windows per scenario. */
  windows: 10,
  /** Upper bound on ops issued per window (at least 1 is always attempted). */
  opsPerWindow: 5,
  /** AC1: 3–5 replicas. NEVER 2. */
  minReplicas: 3,
  maxReplicas: 5,
} as const;

/**
 * Per-test timeout for a fuzz-driven case.
 *
 * Vitest's default is 5 s, which a scenario BAND exceeds under full-suite
 * parallel load even though it takes about a second on its own. That is a
 * property of the runner's scheduling, not of the fuzzer, so the answer is an
 * explicit budget rather than a smaller sample: shrinking the scenario count to
 * fit a default would be trading coverage for a number nobody chose.
 *
 * It is a NAMED CONSTANT alongside `FUZZ_BUDGET` for the same reason — CI raises
 * both together.
 */
export const FUZZ_TEST_TIMEOUT_MS = 120_000;

export interface FuzzScenarioOptions {
  readonly seed: number;
  readonly registry: OpRegistry;
  /** Establishes the initial world. Called once, on replica 0, before window 0. */
  readonly bootstrap: (ctx: OpContext) => Promise<void> | void;
  /** Runs every pending debounced timer. The suite injects vitest's fake-timer flush. */
  readonly flushTimers: () => void;
  readonly replicaCount?: number;
  readonly windows?: number;
  readonly opsPerWindow?: number;
  /** Canonical `.canvas` path every replica subscribes to. */
  readonly path?: string;
  /**
   * Called once, on the SETTLED replicas, after every family has been checked
   * and before teardown.
   *
   * The WP-link tests use it to assert a property that lives BELOW the file
   * projection — that a tombstoned record's `Y.Map` still holds every field
   * (WP19), that a quarantine entry carries `q:true` on every replica (WP20).
   * It is an inspection seam, never a mutation one.
   */
  readonly inspect?: (replicas: readonly FuzzReplica[], trace: IntentTrace) => void;
  /**
   * Called after EVERY window has healed and settled, and once after the
   * bootstrap. A property that must hold continuously — "no record's key set
   * ever shrinks" — cannot be checked from the end state alone, because a key
   * that vanishes and is later rewritten leaves no trace there.
   */
  readonly onWindowSettled?: (replicas: readonly FuzzReplica[], window: number) => void;
  /**
   * WP36 follow-up (B32): build every replica with the collaborative-text write
   * DISABLED, i.e. the pre-WP36 whole-string LWW register. A build mode, not an
   * op class — the core still knows no op by name.
   */
  readonly collabText?: boolean;
}

export interface FuzzResult {
  readonly seed: number;
  readonly replicaCount: number;
  readonly windows: number;
  /** Op classes that actually ran, in first-use order — the coverage evidence. */
  readonly opsUsed: readonly string[];
  readonly opsApplied: number;
  readonly loggedWrites: number;
  readonly quiesced: boolean;
  readonly violations: readonly FuzzViolation[];
  readonly trace: IntentTrace;
  /** Replica 0's converged `.canvas` projection — every replica's, by AC2. */
  readonly finalCanvas: string;
  /** A one-line reproduction hint printed with any failure. */
  readonly reproduce: string;
}

function makeContext(
  rng: FuzzRng,
  replica: FuzzReplica,
  replicas: readonly FuzzReplica[],
  trace: IntentTrace,
  claims: SlotClaims,
  window: number,
  flushTimers: () => void,
  nextId: (prefix: string) => string,
  partitionOf: (index: number) => number,
): OpContext {
  return { rng, replica, replicas, trace, claims, window, flushTimers, nextId, partitionOf };
}

/**
 * Run one scenario end to end and return every violation it found.
 *
 * Deliberately does NOT throw: a scenario is data, so a caller can run many and
 * report all of them, and the fault-injection matrix can ask "which families did
 * this fault trip?" instead of only "did something trip?".
 */
export async function runFuzzScenario(options: FuzzScenarioOptions): Promise<FuzzResult> {
  const rng = createRng(options.seed);
  const replicaCount =
    options.replicaCount ?? rng.between(FUZZ_BUDGET.minReplicas, FUZZ_BUDGET.maxReplicas);
  if (replicaCount < 3) {
    throw new Error(
      `WP23 AC1: the fuzzer runs 3–5 replicas, never ${replicaCount}. ` +
        `With two peers an agreed-but-wrong outcome and a converged one are the same picture.`,
    );
  }
  const windows = options.windows ?? FUZZ_BUDGET.windows;
  const opsPerWindow = options.opsPerWindow ?? FUZZ_BUDGET.opsPerWindow;
  const path = options.path ?? "fuzz.canvas";

  const replicas: FuzzReplica[] = [];
  for (let index = 0; index < replicaCount; index++) {
    replicas.push(await createReplica(index, path, { collabText: options.collabText }));
  }

  const trace = new IntentTrace();
  const claims = new SlotClaims();
  let idSerial = 0;
  const nextId = (prefix: string): string => `${prefix}${(idSerial++).toString(36)}`;
  const opsUsed: string[] = [];
  let opsApplied = 0;
  let partitionIndexOf: (index: number) => number = () => 0;

  try {
    // ---- bootstrap: one shared world, then everybody at rest -------------
    await options.bootstrap(
      makeContext(rng, replicas[0], replicas, trace, claims, -1, options.flushTimers, nextId, () => 0),
    );
    quiesce(replicas, options.flushTimers);
    options.onWindowSettled?.(replicas, -1);
    claims.clear();

    // ---- the windows ------------------------------------------------------
    for (let window = 0; window < windows; window++) {
      claims.clear();
      const partition = drawPartition(rng, replicaCount);
      const groupOf = new Map<number, number>();
      partition.forEach((group, groupIndex) => {
        for (const member of group) groupOf.set(member, groupIndex);
      });
      partitionIndexOf = (index: number) => groupOf.get(index) ?? 0;

      const attempts = rng.between(1, opsPerWindow);
      for (let attempt = 0; attempt < attempts; attempt++) {
        const replica = replicas[rng.int(replicaCount)];
        const ctx = makeContext(
          rng,
          replica,
          replicas,
          trace,
          claims,
          window,
          options.flushTimers,
          nextId,
          partitionIndexOf,
        );
        const definition: OpDefinition | undefined = options.registry.draw(ctx);
        if (definition === undefined) continue;
        const ran = await definition.run(ctx);
        if (!ran) continue;
        opsApplied += 1;
        if (!opsUsed.includes(definition.name)) opsUsed.push(definition.name);
      }

      deliverWithinPartition(rng, replicas, partition);
      quiesce(replicas, options.flushTimers);
      options.onWindowSettled?.(replicas, window);
    }

    // ---- final settle + the assertion families ---------------------------
    const quiesced = quiesce(replicas, options.flushTimers) && stateVectorsAgree(replicas);
    const violations = checkAllFamilies(replicas, trace);
    options.inspect?.(replicas, trace);
    const all: FuzzViolation[] = quiesced
      ? [...violations]
      : [
          { family: "sec", message: "the run never reached quiescence within the round budget" },
          ...violations,
        ];

    return {
      seed: options.seed,
      replicaCount,
      windows,
      opsUsed,
      opsApplied,
      loggedWrites: trace.opCount,
      quiesced,
      violations: all,
      trace,
      finalCanvas: projectFile(replicas[0]).text,
      reproduce: `runFuzzScenario({ seed: ${options.seed}, replicaCount: ${replicaCount}, windows: ${windows} })`,
    };
  } finally {
    for (const replica of replicas) replica.destroy();
  }
}

/** Format violations for an assertion message — grouped, with the seed up front. */
export function describeResult(result: FuzzResult): string {
  if (result.violations.length === 0) return "";
  const lines = [
    `WP23 fuzzer FAILED — reproduce with: ${result.reproduce}`,
    `  replicas=${result.replicaCount} windows=${result.windows} ops=${result.opsApplied} logged-writes=${result.loggedWrites}`,
    `  op classes exercised: ${result.opsUsed.join(", ") || "(none)"}`,
  ];
  for (const violation of result.violations) {
    lines.push(`  [${violation.family}] ${violation.message}`);
  }
  return lines.join("\n");
}
