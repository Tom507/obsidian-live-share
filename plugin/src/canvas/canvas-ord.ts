// WP13 / P1 — the FRACTIONAL `ord` ALLOCATOR and the ONE total order.
//
// Why it exists (BUILD_SPEC §4.3, CONCEPT_V2 Teil 4): V1 derived a canvas's
// record order from `Y.Map` iteration order, which Yjs does not specify. Two
// replicas holding byte-identical state could therefore emit the nodes of the
// same `.canvas` file in different sequences — a diff on every save, a merge
// conflict for a git-backed vault, and no test that inspects one record at a
// time can see it. Order is not a property of the container here; it is DATA:
// every record carries an `ord`, and the order of the canvas is whatever
// sorting by `(ord, id)` says it is.
//
// `ord` is a fractional-index STRING, never a number. Inserting between two
// neighbours means finding a value strictly between them, and floats run out
// of representable midpoints after ~50 nested inserts. A digit string never
// does: it just grows one character (AC3).
//
// ─────────────────────────────────────────────────────────────────────────
// THIS MODULE IS THE SINGLE AUTHORITY ON ORD ORDER
// ─────────────────────────────────────────────────────────────────────────
// Shared Ownership Contract §1: WP13 owns the alphabet, the allocator, the
// `ord` comparator and the `(ord, id)` total-order comparator. WP8 (migration
// ord assignment), WP16 (reorder detection) and WP17 (canonical `.canvas`
// serialisation) IMPORT `compareOrd` / `compareOrdId` from here and must never
// re-implement them — not with `<` on raw strings, not with `localeCompare`,
// not with a parsed numeric interpretation. If one consumer compared `ord`s by
// a different rule, every suite would still pass while replicas silently
// disagreed on file byte order — precisely the guarantee WP17 AC3 exists to
// provide. `compareOrd` is total, deterministic, host-independent and
// locale-independent; it is the only correct way to compare two `ord` values.
//
// ─────────────────────────────────────────────────────────────────────────
// THE FORMAT, STATED PRECISELY (for WP8 / WP16 / WP17)
// ─────────────────────────────────────────────────────────────────────────
//   ord := <fraction digits><client tag digits>
//
//   ├── alphabet  → "0-9A-Za-z" (base 62), chosen so that ASCII order,
//   │               UTF-16 code-unit order and digit VALUE order coincide
//   ├── fraction  → the jittered digits that place the value strictly between
//   │               its two neighbours; conceptually the digits after the
//   │               "0." of a base-62 fraction in (0, 1)
//   ├── client tag→ 12 digits derived deterministically from `clientID`, the
//   │               tiebreak that keeps two clients allocating between the
//   │               SAME pair from producing the same string (AC2)
//   └── canonical → the string never ends in "0", so two distinct strings are
//                   always two distinct positions and lexicographic order is
//                   the value order
//
// There is deliberately NO separator between the two parts: an `ord` is one
// opaque base-62 digit string, and nothing downstream ever parses it. A
// consumer only ever COMPARES `ord`s, never interprets them.
//
// `ord` lives in the doc only. It is never written to the `.canvas` file
// (BUILD_SPEC §4.3) — the file's order IS the sorted order, so persisting the
// key would be redundant state that could disagree with itself.
//
// ─────────────────────────────────────────────────────────────────────────
// IMMUTABILITY (AC4)
// ─────────────────────────────────────────────────────────────────────────
// An allocated `ord` is immutable. This module offers allocation of NEW values
// and comparison — and nothing else. There is no setter, no updater, no
// rebalance, no compaction: rewriting an existing `ord` in place is a
// concurrent-move-and-reorder data loss waiting to happen, and a module that
// cannot express it cannot suffer it. The exported surface is pinned by a
// dynamic scan in `v2/wp13/test_tp07_no_mutating_export_visible.test.ts`; a
// later WP that adds a mutator breaks that test rather than the production
// canvas.
//
// Purity contract (BUILD_SPEC §3, D12): this module imports NOTHING — no
// editor host, no filesystem, no clock, not Yjs. Randomness enters through the
// injected `rng` seam ONLY, so allocation is fully reproducible under a seeded
// generator; `Math.random` appears exactly once, as the default argument used
// when a caller supplies no generator. The precedents are `reconcile-plan.ts`
// and `canvas-registers.ts`.

/**
 * The randomness seam.
 *
 * Returns a value in `[0, 1)` — the same contract as `Math.random`, so a test
 * can hand in a seeded generator (mulberry32) and replay an entire allocation
 * sequence. Jitter must never read an ambient source directly: an allocator
 * that did could not be reproduced from a failing run.
 */
export type OrdRng = () => number;

/** One record's position key: its `ord` plus its stable record `id`. */
export interface OrdIdEntry {
  readonly ord: string;
  readonly id: string;
}

// ---------------------------------------------------------------------------
// PART A — the alphabet (module-private; the format is an implementation
// detail, only the ORDER is a contract)
// ---------------------------------------------------------------------------

/**
 * Base-62 digits in ascending ASCII order.
 *
 * Digits before uppercase before lowercase is exactly ASCII/UTF-16 order, so
 * "compare the digit strings lexicographically" and "compare the fractions
 * numerically" are the same operation. Any alphabet whose characters were not
 * in code-unit order would make `compareOrd` and `<` disagree, which is the
 * silent-divergence trap this component exists to close.
 */
const ORD_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 62. */
const ORD_BASE = ORD_ALPHABET.length;

/** The zero digit — never the last character of a well-formed `ord`. */
const ZERO_DIGIT = ORD_ALPHABET.charAt(0);

const DIGIT_VALUES: Map<string, number> = (() => {
  const values = new Map<string, number>();
  for (let index = 0; index < ORD_ALPHABET.length; index++) {
    values.set(ORD_ALPHABET.charAt(index), index);
  }
  return values;
})();

/**
 * The numeric value of one digit.
 *
 * A character outside the alphabet can only come from an `ord` this module did
 * not produce (a hand-edited doc, a future format). It is clamped to the
 * nearest end of the alphabet rather than throwing: the allocator degrades to
 * "somewhere sensible" instead of breaking a canvas save (I5).
 */
function digitValue(character: string): number {
  const value = DIGIT_VALUES.get(character);
  if (value !== undefined) return value;
  return character < ZERO_DIGIT ? 0 : ORD_BASE - 1;
}

/**
 * Drop trailing zero digits, the one canonicalisation this format needs.
 *
 * `"A0"` and `"A"` denote the same position, but as strings `"A" < "A0"`. If
 * both spellings could exist, `compareOrd` would report an order between two
 * values that are the same position, and an insert between them would have
 * nowhere to go. Every value leaves the allocator canonical, and any value
 * arriving from elsewhere is canonicalised before it is used as a bound.
 */
function trimTrailingZeros(digits: string): string {
  let end = digits.length;
  while (end > 0 && digits.charAt(end - 1) === ZERO_DIGIT) end--;
  return digits.slice(0, end);
}

// ---------------------------------------------------------------------------
// PART B — allocation
// ---------------------------------------------------------------------------

/**
 * How far above the lower neighbour an unbounded (append) allocation may jump.
 *
 * Appending is the bulk case — a migration assigning `ord` to every record of
 * an existing canvas does nothing else (WP8) — so an append takes a SMALL
 * jittered step rather than landing uniformly in the whole remaining space.
 * Uniform jumps would burn through the digit space in a handful of appends and
 * force the string to grow far sooner. The jitter still spans several digits,
 * which is all it is for: two peers appending at the same time usually differ
 * in the fraction as well as in the client tag.
 */
const APPEND_JITTER_SPAN = 4;

/**
 * Pick one digit strictly inside `(low, high)`, jittered through the injected
 * generator. `span` is the number of candidates; the result is clamped so a
 * generator that violates the `[0, 1)` contract still cannot produce a digit
 * outside the open interval.
 */
function pickDigit(low: number, high: number, rng: OrdRng): number {
  const first = low + 1;
  const span = high - first;
  const raw = rng();
  const scaled = Number.isFinite(raw) ? Math.floor(raw * span) : 0;
  const offset = scaled < 0 ? 0 : scaled >= span ? span - 1 : scaled;
  return first + offset;
}

/**
 * The core: build the shortest jittered digit string strictly between two
 * bounds, where `lower` may be `""` (start of the sequence) and `upper` may be
 * `undefined` (end of the sequence).
 *
 * It walks both bounds one digit at a time:
 *
 *   ├── the digits differ by more than 1 → there is room here; pick a jittered
 *   │   digit strictly between them and stop. That digit is >= 1, so the result
 *   │   never ends in "0".
 *   ├── the digits differ by exactly 1 → no room at this depth; take the LOWER
 *   │   bound's digit and descend. Every continuation now starts with a digit
 *   │   below the upper bound's, so the upper bound stops binding entirely.
 *   └── the digits are equal → copy it and descend with both bounds still
 *       binding.
 *
 * Termination is structural, not probabilistic: once the walk passes the end of
 * both bounds the gap is the full alphabet, so a digit is always available.
 * That is AC3 — the string grows, it never collides and there is no precision
 * floor to exhaust.
 */
function allocateFraction(lower: string, upper: string | undefined, rng: OrdRng): string {
  // "Append" means the CALLER had no upper neighbour — not merely that the
  // walk dropped one on the way down. An insert that descended past a
  // too-narrow ceiling still wants the balanced (whole-gap) jitter, so that
  // the space it leaves behind is shared between the two sides it sits
  // between; a true append instead wants a small step, so the digits above it
  // stay available for the next append.
  const appending = upper === undefined;
  let prefix = "";
  let bound = upper;
  let index = 0;

  for (;;) {
    const low = index < lower.length ? digitValue(lower.charAt(index)) : 0;
    const high =
      bound === undefined || index >= bound.length ? ORD_BASE : digitValue(bound.charAt(index));

    if (high - low > 1) {
      const ceiling =
        appending && high === ORD_BASE ? Math.min(high, low + 1 + APPEND_JITTER_SPAN) : high;
      return prefix + ORD_ALPHABET.charAt(pickDigit(low, ceiling, rng));
    }

    if (high - low === 1) {
      // No room at this depth. Taking the lower bound's digit puts every
      // continuation strictly below the upper bound, which is therefore no
      // longer a constraint.
      prefix += ORD_ALPHABET.charAt(low);
      bound = undefined;
      index++;
      continue;
    }

    prefix += ORD_ALPHABET.charAt(low);
    index++;
  }
}

// ---------------------------------------------------------------------------
// PART C — the client tag (the AC2 tiebreak)
// ---------------------------------------------------------------------------

/** Two 32-bit words, six base-62 digits each (62^6 > 2^32). */
const TAG_WORD_DIGITS = 6;
const TAG_SEED_A = 0x811c9dc5;
const TAG_SEED_B = 0x1b873593;
const FNV_PRIME = 0x01000193;

function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash = (hash ^ text.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** Final avalanche, so two similar clientIDs produce unrelated tags. */
function mix32(value: number): number {
  let x = value >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}

function encodeFixedWidth(value: number, width: number): string {
  let remaining = value >>> 0;
  let digits = "";
  for (let position = 0; position < width; position++) {
    digits = ORD_ALPHABET.charAt(remaining % ORD_BASE) + digits;
    remaining = Math.floor(remaining / ORD_BASE);
  }
  return digits;
}

/**
 * The `clientID` tiebreak suffix: a fixed-width, deterministic base-62
 * fingerprint of the allocating client.
 *
 * Two clients inserting between the SAME pair with the SAME jitter draws would
 * otherwise produce the same string (AC2). Appending the tag makes that
 * impossible without disturbing the ordering: the fraction has already placed
 * the value strictly inside the interval in a way no suffix can undo (see
 * {@link allocateFraction}), so the tag can only decide between siblings.
 *
 * Fixed width on purpose — equal-length tags are what makes the trailing-zero
 * canonicalisation unable to map two different clients onto one string.
 *
 * It is a fingerprint, not the literal id, so an `ord` stays short whatever a
 * host uses for `clientID`. Two clientIDs sharing a 64-bit fingerprint would
 * produce equal `ord`s, which is not a correctness hole: `compareOrdId` breaks
 * exactly that tie on the record `id`, which is why the total order is over
 * `(ord, id)` and not over `ord` alone.
 */
function clientTag(clientID: string): string {
  const wordA = mix32(fnv1a32(clientID, TAG_SEED_A));
  const wordB = mix32(fnv1a32(clientID, TAG_SEED_B));
  return encodeFixedWidth(wordA, TAG_WORD_DIGITS) + encodeFixedWidth(wordB, TAG_WORD_DIGITS);
}

// ---------------------------------------------------------------------------
// PART D — the exported surface (allocate + compare, nothing else)
// ---------------------------------------------------------------------------

/**
 * Allocate a new `ord` strictly between two neighbours.
 *
 * `before` absent means "at the start of the sequence", `after` absent means
 * "at the end"; both absent is the base case for the first record of a canvas.
 * The result is always strictly greater than `before` and strictly less than
 * `after` under {@link compareOrd} — head, tail and middle alike (AC1) — and
 * repeated allocation between ever-closer neighbours keeps working by growing
 * the string (AC3).
 *
 * The value is NEW; nothing existing is rewritten (AC4). Two clients handed the
 * same neighbours and the same jitter stream still get different strings,
 * because the `clientID` tag rides along (AC2).
 *
 * `rng` is the mandatory randomness seam: pass a seeded generator to make a
 * whole allocation sequence reproducible. `Math.random` is used only when the
 * caller supplies nothing.
 *
 * Degenerate input — `after` not strictly above `before` — cannot come from a
 * consistent view of a canvas, so there is no value that satisfies the request.
 * Rather than throw inside a save path, the allocator drops the impossible
 * upper bound and allocates after `before`: the record lands at the end instead
 * of in the middle, which is recoverable, whereas a thrown error mid-capture is
 * not (I5, degrade never break).
 */
export function allocateOrd(
  before: string | undefined,
  after: string | undefined,
  clientID: string,
  rng: OrdRng = Math.random,
): string {
  const lower = trimTrailingZeros(before ?? "");
  const trimmedUpper = after === undefined ? undefined : trimTrailingZeros(after);
  const upper =
    trimmedUpper === undefined || trimmedUpper.length === 0 || lower >= trimmedUpper
      ? undefined
      : trimmedUpper;

  return trimTrailingZeros(allocateFraction(lower, upper, rng) + clientTag(clientID));
}

/**
 * Compare two `ord` values. THE definition of `ord` order (Shared Ownership
 * Contract §1) — every consumer imports this one.
 *
 * Plain code-unit comparison of the whole string: total, transitive,
 * antisymmetric, locale-independent, host-independent, and identical on every
 * replica by construction. It deliberately does NOT parse the string, does not
 * use `localeCompare` (whose result depends on the host's ICU data) and does
 * not treat the value as a number.
 *
 * @returns `<0` when `a` sorts first, `0` when the two values are the same
 * position, `>0` when `b` sorts first — the standard `Array.prototype.sort`
 * comparator contract.
 */
export function compareOrd(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compare two records by `(ord, id)` — the project's canonical record order.
 *
 * `ord` decides; the record `id` breaks the tie when two records carry the same
 * `ord`. That fallback is what makes the order TOTAL rather than merely
 * probable: allocation makes equal `ord`s vanishingly unlikely, but "unlikely"
 * would still leave the file's byte order undefined for the pair, and WP17's
 * byte-equality guarantee admits no undefined case.
 *
 * The tiebreak is the same plain code-unit comparison as {@link compareOrd},
 * for the same reason: two replicas must agree without agreeing on a locale.
 */
export function compareOrdId(a: OrdIdEntry, b: OrdIdEntry): number {
  const byOrd = compareOrd(a.ord, b.ord);
  if (byOrd !== 0) return byOrd;
  return compareOrd(a.id, b.id);
}
