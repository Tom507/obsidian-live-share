// WP23 — the fuzzer's SEEDED PRNG (AC3: "runs are reproducible from their seed").
//
// Written here rather than pulled in, for two reasons that are both constraints
// of this initiative rather than preferences:
//
//   ├── ZERO NEW RUNTIME DEPENDENCIES (BUILD_SPEC §3 / charter §5). Yjs,
//   │      `y-protocols`, `lib0` and `minimatch` are the only libraries this
//   │      repo may use, and no property-testing library may be added. A fuzzer
//   │      needs randomness it can replay; thirty lines of mulberry32 is the
//   │      whole of that need.
//   └── `Math.random()` IS NOT REPLAYABLE. A counter-example found by a run that
//          cannot be re-run is not a counter-example, it is an anecdote — and
//          AC3 requires the run to be reproducible from its seed BEFORE it
//          requires anything else.
//
// mulberry32: 32-bit state, one multiply-xorshift round per draw, period 2^32.
// Statistically far better than an LCG for this purpose and — the property that
// actually matters here — TOTALLY deterministic: the same seed replays the same
// stream on every host, in every Node version, forever.

/** The randomness surface every op and the scheduler draw from. Never `Math.random`. */
export interface FuzzRng {
  /** The seed this stream was created from — carried so a failure can name it. */
  readonly seed: number;
  /** Uniform in `[0, 1)`. */
  next(): number;
  /** Uniform integer in `[0, maxExclusive)`. Returns 0 for a non-positive bound. */
  int(maxExclusive: number): number;
  /** Uniform integer in `[min, max]` inclusive. */
  between(min: number, max: number): number;
  /** `true` with probability `p` (default 0.5). */
  bool(p?: number): boolean;
  /** One uniformly chosen element, or `undefined` for an empty input. */
  pick<T>(items: readonly T[]): T | undefined;
  /** A NEW array, Fisher-Yates shuffled. The input is never mutated. */
  shuffle<T>(items: readonly T[]): T[];
  /** One element chosen by weight. Weights must be positive. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T | undefined;
}

/**
 * A deterministic stream from one 32-bit seed.
 *
 * `seed >>> 0` so a negative or fractional seed still produces a well-defined
 * stream rather than silently degenerating.
 */
export function createRng(seed: number): FuzzRng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  };

  return {
    seed: seed >>> 0,
    next,
    int,
    between: (min, max) => (max <= min ? min : min + int(max - min + 1)),
    bool: (p = 0.5) => next() < p,
    pick: <T>(items: readonly T[]): T | undefined =>
      items.length === 0 ? undefined : items[int(items.length)],
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const swap = out[i];
        out[i] = out[j];
        out[j] = swap;
      }
      return out;
    },
    weighted: <T>(items: readonly T[], weightOf: (item: T) => number): T | undefined => {
      let total = 0;
      for (const item of items) total += Math.max(0, weightOf(item));
      if (total <= 0) return undefined;
      let ticket = next() * total;
      for (const item of items) {
        ticket -= Math.max(0, weightOf(item));
        if (ticket < 0) return item;
      }
      return items[items.length - 1];
    },
  };
}
