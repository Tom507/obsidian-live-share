// WP23 / AC4 — THE PLUGGABLE OP REGISTRY.
//
// "The op registry is open for extension so later phases can add ops without
// modifying the fuzzer core." That is a STRUCTURAL requirement, not a stylistic
// one, so it is expressed structurally: `fuzzer.ts` imports this file for the
// `OpRegistry` TYPE only and never for a concrete op. A later phase adds an op
// by calling `registry.register(...)`; nothing in the core changes, is
// recompiled differently, or grows a `case` arm.
//
// The second half of AC4 — "every WP in this spec that changes merge or
// serialisation behaviour is reachable through at least one registered op" — is
// machine-checkable rather than a promise, because every definition declares
// which WPs it reaches (`reaches`) and `OpRegistry.coverage()` returns the
// union. A test asserts the required set is covered, so deleting an op class
// breaks a test instead of silently shrinking the fuzzer.

import type { FieldSlot, IntentTrace, SlotClaims } from "./intent-trace";
import type { FuzzRng } from "./prng";
import type { FuzzReplica } from "./replica";

/** Everything an op is given. Deliberately narrow — an op cannot reach the oracle. */
export interface OpContext {
  readonly rng: FuzzRng;
  /** The replica issuing this op. */
  readonly replica: FuzzReplica;
  readonly replicas: readonly FuzzReplica[];
  /** The harness's own account of the world. An op WRITES to it; it never reads a doc for truth. */
  readonly trace: IntentTrace;
  /** This window's slot ledger — the mechanism that keeps the oracle deterministic. */
  readonly claims: SlotClaims;
  readonly window: number;
  /** Run all pending debounced timers (the injected fake-timer flush). */
  readonly flushTimers: () => void;
  /** Monotonic counter for fresh record ids, so ids never collide across a run. */
  nextId(prefix: string): string;
  /**
   * Which partition group a replica is in THIS window. An op that wants a
   * genuinely concurrent pair (the WP21 link) needs two replicas that cannot see
   * each other, and this is how it finds them.
   */
  partitionOf(replicaIndex: number): number;
}

/**
 * One op CLASS. `run` returns `false` when the op declined to act (no eligible
 * target, or its slot was already claimed this window) — declining is normal and
 * is not a failure.
 */
export interface OpDefinition {
  readonly name: string;
  /** Relative draw weight. */
  readonly weight: number;
  /** Which work packages this op class makes reachable (AC4, second half). */
  readonly reaches: readonly string[];
  /**
   * A one-line note carried into the report. Used to state plainly where a
   * mechanism does NOT yet exist rather than faking it.
   */
  readonly note?: string;
  applicable(ctx: OpContext): boolean;
  run(ctx: OpContext): boolean | Promise<boolean>;
}

/**
 * The registry. `register` is the ONLY extension point and it is additive: a
 * later phase's ops are appended, never merged into a switch in the core.
 */
export class OpRegistry {
  private readonly definitions: OpDefinition[] = [];

  register(definition: OpDefinition): this {
    if (this.definitions.some((existing) => existing.name === definition.name)) {
      throw new Error(`WP23 op registry: duplicate op class "${definition.name}"`);
    }
    this.definitions.push(definition);
    return this;
  }

  list(): readonly OpDefinition[] {
    return this.definitions;
  }

  get(name: string): OpDefinition | undefined {
    return this.definitions.find((definition) => definition.name === name);
  }

  /**
   * A NEW registry holding only the named definitions.
   *
   * A read-only derivation, so a focused test can drive one WP's op classes
   * without the core learning about them and without anything being removed from
   * the standard registry. `subset` never mutates and never reorders.
   */
  subset(names: readonly string[]): OpRegistry {
    const out = new OpRegistry();
    for (const name of names) {
      const definition = this.get(name);
      if (definition === undefined) {
        throw new Error(`WP23 op registry: no op class named "${name}"`);
      }
      out.register(definition);
    }
    return out;
  }

  /** The union of every registered op's `reaches`. AC4's coverage claim, as data. */
  coverage(): Set<string> {
    const out = new Set<string>();
    for (const definition of this.definitions) {
      for (const wp of definition.reaches) out.add(wp);
    }
    return out;
  }

  /** Pick one applicable op by weight, or `undefined` when none applies. */
  draw(ctx: OpContext): OpDefinition | undefined {
    const eligible = this.definitions.filter((definition) => definition.applicable(ctx));
    return ctx.rng.weighted(eligible, (definition) => definition.weight);
  }
}

/** Convenience for op authors: claim a slot, or decline. */
export function claimOrDecline(ctx: OpContext, slot: FieldSlot): boolean {
  return ctx.claims.claim(slot);
}
