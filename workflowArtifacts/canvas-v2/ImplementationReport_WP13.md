# Implementation Report — WP13

**WP:** WP13 — Fractional `ord` allocator (component C13, phase P1)
**Attempt:** 1
**Module:** `plugin/src/canvas/canvas-ord.ts` (new, pure core, zero imports)

## Status: DONE

All 7 visible test files (20 tests) pass. `npx tsc -noEmit -skipLibCheck` introduces no new error
(pre-existing `src/__tests__/wp49/` errors from a concurrent worker are untouched and unrelated).

---

## Completed Work

| AC | Requirement | Where it is realised | Result |
|---|---|---|---|
| AC1 | An allocated value sorts strictly between its two neighbours under the module's comparison, including at head and tail | `allocateFraction` — digit-by-digit walk of both bounds; `before` absent → lower bound `""`, `after` absent → open upper bound | PASS (TC1, TC2, TC3) |
| AC2 | Two clients allocating between the same pair produce different strings; `(ord, id)` is identical on every replica | jitter through the injected `rng` **plus** a fixed-width 12-digit `clientID` fingerprint appended to every allocation; `compareOrdId` = `compareOrd` then `id` | PASS (TC4, TC5) |
| AC3 | Repeated allocation between ever-closer neighbours terminates and stays correct — the string grows rather than colliding or losing precision | the walk descends one digit deeper whenever the gap is too narrow; termination is structural (past the end of both bounds the gap is the whole alphabet), never floating-point | PASS (TC6) |
| AC4 | An allocated value is immutable: no operation rewrites an existing `ord` in place | the module exports exactly three functions and two types; every helper (alphabet, digit walk, hash, canonicalisation) is module-private | PASS (TC7) |

**Definition of Done —** `(ord, id)` is a total order that all replicas compute identically:
`compareOrd` is plain UTF-16 code-unit comparison (no locale, no host data, no parsing), and
`compareOrdId` breaks the equal-`ord` case on `id`, so the order is total with no undefined case.

## Blocked Items

None. No `SPEC_CONTRADICTION`, no escalation, no `TOOL_REQUEST`.

## Tools Created

None.

## Changes Made

| File | Change |
|---|---|
| `plugin/src/canvas/canvas-ord.ts` | **created** — the whole WP (≈300 lines incl. the header contract and JSDoc) |
| `workflowArtifacts/canvas-v2/TaskCharter_WP13_FractionalOrdAllocator.md` | Charter Status `TESTS_ADDED` → `DONE`; §8 and §9 filled |
| `workflowArtifacts/canvas-v2/ImplementationReport_WP13.md` | this report |

Nothing else was touched: no test was deleted, skipped, weakened or edited; no existing module was
modified; no version bump; no `npm run build`; no formatter or `lint --fix`; `server/`, `docker/`,
`deploy/`, `plugin/main.js`, `manifest.json` and `package.json` untouched.

## Exported API surface (for the WPs that will import this)

Exactly the Shared Ownership Contract §1 surface — nothing more (AC4 is pinned by a dynamic export
scan, so adding an export breaks TC7):

```ts
export type OrdRng = () => number;                    // [0, 1); the injected randomness seam

export function allocateOrd(
  before: string | undefined,                          // undefined = "at the start"
  after: string | undefined,                           // undefined = "at the end"
  clientID: string,
  rng?: OrdRng,                                        // defaults to Math.random only when omitted
): string;

export function compareOrd(a: string, b: string): number;      // <0 | 0 | >0

export interface OrdIdEntry { readonly ord: string; readonly id: string }

export function compareOrdId(a: OrdIdEntry, b: OrdIdEntry): number;
```

**Rules for consumers (WP8 migration, WP16 reorder detection, WP17 `(ord, id)` serialisation):**

- Compare `ord`s **only** through `compareOrd` / `compareOrdId`. Never `<` on the raw string, never
  `localeCompare` (host ICU data), never a numeric interpretation. Raw `<` happens to agree today —
  that is exactly what makes a divergent second comparator undetectable by tests.
- `Array.prototype.sort(compareOrdId)` is the canonical record order. It is total, so the sorted
  sequence is byte-identical on every replica (WP17 AC3).
- There is no rewrite/rebalance operation and there must never be one. Reordering means allocating
  a **new** `ord` for the moved record between its new neighbours.
- The randomness seam is mandatory: pass a seeded `rng` in tests so an allocation sequence replays.
- `ord` is never written to the `.canvas` file (BUILD_SPEC §4.3). The file's *order* is the value.

## The `ord` format, stated precisely

```text
ord := <fraction digits><client tag digits>          (one opaque base-62 string, no separator)

├── alphabet    → "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" (base 62)
│                  chosen so digit-value order == ASCII order == UTF-16 code-unit order
├── fraction    → the jittered digits that place the value strictly between its neighbours;
│                  conceptually the digits after the "0." of a base-62 fraction in (0, 1)
├── client tag  → exactly 12 digits, deterministic from clientID
│                  (two 32-bit FNV-1a hashes, different seeds, each avalanche-mixed,
│                   each rendered as 6 fixed-width base-62 digits — 62^6 > 2^32)
└── canonical   → the string NEVER ends in "0"; trailing zeros are trimmed on the way out and
                   on any bound coming in, so one position has exactly one spelling
```

Properties a consumer may rely on:

1. **Order.** For well-formed `ord`s, `compareOrd(a, b)` is the lexicographic code-unit order of the
   two strings, and that equals the order of the base-62 fractions they denote. Total, transitive,
   antisymmetric, locale- and host-independent.
2. **Betweenness.** `allocateOrd(b, a, …)` returns `r` with `compareOrd(b, r) < 0 < compareOrd(r, a)`
   for every well-formed `b < a`, including `b === undefined` (head) and `a === undefined` (tail).
   The tag suffix cannot break this: the fraction has already placed the value strictly inside the
   interval in a way no appended digits can undo.
3. **Distinctness.** Two different `clientID`s allocating between the same pair with the same jitter
   draws still differ, because the tag differs. Two clientIDs sharing a 64-bit fingerprint would
   produce equal `ord`s — not a correctness hole, that is precisely the case `compareOrdId` resolves
   on `id`, which is why the total order is over `(ord, id)` and not over `ord` alone.
4. **Length.** Minimum 12 characters (tag only, after trimming), typically 13. It grows with
   insertion depth; measured on this implementation:
   - 2 000 sequential tail appends (the WP8 migration shape) → final length **97**
   - 2 000 successive head inserts → final length **435**
   - 3 000 inserts always narrowing toward the same lower neighbour → final length **638**
   No plateau, no collision, no precision floor — growth *is* the AC3 mechanism.
   Note for WP8: a migration that assigns `ord` by repeated tail append gets ~1 extra character per
   ~20 records; that is expected and cheap, and the values never need rebalancing.
5. **Degenerate input.** If `after` is not strictly above `before` (swapped, equal, or empty), no
   value can satisfy the request. The allocator does **not** throw inside a save path: it drops the
   impossible upper bound and allocates strictly after `before` (documented at the call site).
   The result is still never equal to a neighbour.
6. **Foreign characters.** A character outside the alphabet can only come from an `ord` this module
   did not produce; it is clamped to the nearest end of the alphabet rather than throwing (I5,
   degrade never break). `compareOrd` itself is total over arbitrary strings regardless.

Two implementation choices worth knowing, both documented in the module header:

- **No separator between fraction and tag.** An `ord` is one opaque digit string; nothing downstream
  parses it, only compares it. A separator would have created a class of neighbour pairs (identical
  fraction, different client) with *nothing* representable between them.
- **The append jitter takes a small step (≤ 4 digits) while an insert jitters across the whole gap.**
  Appends are the bulk case, and uniform jumps would burn the digit space in a handful of appends.

## Visible Test Results

```text
cd plugin && npx vitest run src/__tests__/v2/wp13/ --reporter=dot
  Test Files  7 passed (7)
       Tests  20 passed (20)
    Duration  ~0.5 s
```

| Test file | AC | Result |
|---|---|---|
| `test_tp01_strictly_between_neighbours_visible.test.ts` | AC1 (middle) | PASS (3) |
| `test_tp02_head_allocation_visible.test.ts` | AC1 (head) | PASS (3) |
| `test_tp03_tail_allocation_visible.test.ts` | AC1 (tail) | PASS (3) |
| `test_tp04_distinct_clients_distinct_ords_visible.test.ts` | AC2 | PASS (3) |
| `test_tp05_replica_total_order_agreement_visible.test.ts` | AC2 | PASS (3) |
| `test_tp06_dense_allocation_terminates_visible.test.ts` | AC3 | PASS (2) |
| `test_tp07_no_mutating_export_visible.test.ts` | AC4 | PASS (3) |

All 20 passed on the **first** run of attempt 1; no test was modified.

Typecheck: `cd plugin && npx tsc -noEmit -skipLibCheck` → zero errors outside
`src/__tests__/wp49/` (that bucket's errors are a different worker's concurrent work and predate
this WP; the filtered output is empty).

Beyond the visible suite, the module was probed out-of-tree (bundled to a temp file, run under
node, temp files deleted) for the properties the visible tests bound but do not stress: 2 000
appends, 2 000 head inserts, 3 000 same-side narrowing inserts, 200 inserts squeezed between two
same-fraction siblings, degenerate/swapped/equal/empty bounds, canonical form (never empty, never
trailing `0`, alphabet-only), 20 000 distinct clientIDs against one neighbour pair (20 000 distinct
`ord`s), and 20 random permutations of a 200-entry batch sorting identically. All passed.

## Summary for Worker 3

- WP13 is **DONE** in one attempt. One new file, `plugin/src/canvas/canvas-ord.ts`; nothing else in
  `plugin/src/` was touched, no test was weakened, no version bumped, no build run.
- The exported surface is exactly the Shared Ownership Contract §1 list — three functions
  (`allocateOrd`, `compareOrd`, `compareOrdId`) and two types (`OrdRng`, `OrdIdEntry`). AC4's
  dynamic export scan means **any** future export added here fails TC7, which is intended: it is
  the tripwire against a later `setOrd` / `rebalanceOrds`.
- **Cross-WP note to carry into WP8 / WP16 / WP17:** the single ordering authority is
  `compareOrd` / `compareOrdId`. A consumer that sorts `ord`s with raw `<` will pass its own suite
  and still diverge from WP17's canonical byte order under a different collation. Import, never
  re-implement.
- `npm run build` and the full `npm test` were deliberately **not** run (batch-level gates owned by
  Worker 3). The WP13 bucket and the typecheck are green.
